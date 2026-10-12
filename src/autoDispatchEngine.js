/**
 * autoDispatchEngine.js — Autonomous Dispatch Engine (pure).
 * ─────────────────────────────────────────────────────────────────────
 * One dispatch cycle for ONE municipality, computed from a snapshot of the
 * operational state. No Firebase, no React, no clock other than `now`: the
 * same input always produces the same actions, so the server runner can
 * re-validate them inside a transaction and the tests can pin them down.
 *
 * Order of reasoning (mirrors how a dispatcher works):
 *   1. score every bin (decisionEngine.getBinPriority + getRouteEligibility,
 *      predictions included through recent readings);
 *   2. route exceptions to a human: thermal danger, unreliable sensors on
 *      critical bins — never auto-dispatched;
 *   3. INSERT first: add a bin to an existing approved / in-progress route when
 *      it fits the route's capacity, stop limit and detour budget;
 *   4. GROUP the rest into one optimized route per neighborhood; a routine
 *      route needs `minBinsPerRoute` bins unless it carries an urgent bin;
 *   5. pick the driver with the existing assignment engine (coverage, shift,
 *      availability, vehicle state, capacity, current commitments, approach
 *      time) and auto-assign only when EVERY operating condition holds;
 *   6. RE-EVALUATE assigned routes: driver off shift / unavailable, vehicle
 *      down, or a route not started in time → reassign (auto routes) or
 *      escalate (human-assigned routes are never silently changed);
 *   7. anything that cannot be resolved inside the municipality is escalated
 *      with a suggestion — inter-municipality transfers stay an Amanah decision.
 *
 * Every action carries an idempotency `key` derived from its content, so a
 * repeated or concurrent cycle maps to the same decision document.
 * ─────────────────────────────────────────────────────────────────────
 */
import { getBinPriority, getRouteEligibility, recommendRoutes, haversineDistanceKm, estimateTravelMinutes } from "./decisionEngine.js";
import { optimizeRoute } from "./routeOptimizer.js";
import { rankDriverCandidates } from "./assignmentEngine.js";
import { ACTIVE_ROUTE_STATUSES } from "./fleetEngine.js";
import { THRESHOLDS } from "./config.js";
import { ASSUMPTIONS } from "./impact.js";

export const DISPATCH_MODES = { off: "متوقف", observe: "مراقبة (يحسب ولا ينفذ)", auto: "تنفيذ تلقائي" };
export const DISPATCH_SCOPES = { demo_only: "بيئة العرض فقط (حاويات محاكاة)", all: "كل الحاويات" };

/** Defaults — every number is a setting the authorised admin can change. */
export const DEFAULT_DISPATCH_SETTINGS = {
  mode: "observe",            // off | observe | auto
  scope: "demo_only",         // demo_only | all
  periodMinutes: 15,          // periodic cycle spacing (urgent cases bypass it)
  minBinsPerRoute: 3,         // routine grouping: don't send a truck for fewer bins…
  urgentFillPct: 95,          // …unless one of them is at/above this fill (immediate handling)
  maxApproachMin: 30,         // a driver further than this (approach time) is not auto-assigned
  maxStopsPerRoute: 18,       // hard cap per route
  insertMaxKm: 1,             // a bin may join an existing route if it is this close to a pending stop…
  insertMaxAddedMin: 15,      // …and the detour + service adds at most this many minutes
  allowInsertInProgress: true,
  notStartedEscalateMin: 90,  // an approved route not started after this long is escalated
};

export const ACTION_LABELS = {
  insert: "إضافة إلى جولة قائمة",
  create_assign: "جولة جديدة مسندة تلقائيًا",
  reassign: "إعادة إسناد",
  release: "سحب الإسناد",
  escalate: "رفع لموظف العمليات",
  defer: "تأجيل للتجميع",
};
export const ESCALATION_LABELS = {
  thermal: "خطر حراري — يتطلب قرار موظف",
  sensor: "حاوية حرجة ببيانات غير موثوقة",
  no_driver: "لا سائق مؤهل داخل البلدية",
  capacity: "سعة المركبات لا تستوعب الجولة",
  too_far: "أقرب سائق مؤهل أبعد من الحد المسموح",
  driver_unavailable: "سائق جولة معتمدة لم يعد متاحًا",
  vehicle_down: "مركبة جولة جارية متعطلة",
  not_started: "جولة معتمدة لم تبدأ في الوقت المتوقع",
};

/** Small deterministic string hash (djb2 → base36) for idempotency keys. */
export function stableHash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

const binWaste = (bin) => Math.round((Number(bin.capacityLiters) || 1100) * Math.max(0, Math.min(100, Number(bin.lastFillLevelPercent) || 0)) / 100);
const km = (a, b) => (a?.lat == null || b?.lat == null ? null : haversineDistanceKm(a.lat, a.lng, b.lat, b.lng));
const isUsableVehicle = (v) => !!v && v.status !== "maintenance" && v.status !== "offline";

/** Stops of a route that are still to be served (not collected, not skipped). */
export function pendingStops(route) {
  const done = new Set([...(route.collectedBinIds || []), ...((route.skippedStops || []).map((s) => s.binId))]);
  const stops = route.orderedStops?.length ? route.orderedStops : (route.binIds || []).map((binId, i) => ({ binId, order: i + 1 }));
  return stops.filter((s) => !done.has(s.binId));
}

/**
 * Cheapest insertion of `bin` among the pending stops of `route`.
 * Returns { position (index in orderedStops), detourKm, addedMin } or null when no coordinates.
 */
export function cheapestInsertion(route, bin) {
  if (bin.lat == null || bin.lng == null) return null;
  const stops = route.orderedStops || [];
  const pend = pendingStops(route).filter((s) => s.lat != null && s.lng != null);
  if (pend.length === 0) return null;
  let best = null;
  for (let i = 0; i <= pend.length; i++) {
    const a = pend[i - 1] || null, c = pend[i] || null;
    const ab = a ? km(a, bin) : 0, bc = c ? km(bin, c) : 0, ac = a && c ? km(a, c) : 0;
    const detour = Math.max(0, (ab ?? 0) + (bc ?? 0) - (ac ?? 0));
    if (!best || detour < best.detourKm) {
      const anchor = c ? stops.findIndex((s) => s.binId === c.binId) : stops.length; // insert before c (or append)
      best = { position: anchor < 0 ? stops.length : anchor, detourKm: Math.round(detour * 100) / 100 };
    }
  }
  best.addedMin = Math.round(estimateTravelMinutes(best.detourKm) + ASSUMPTIONS.minutesPerStop);
  best.nearestKm = Math.round(Math.min(...pend.map((s) => km(s, bin) ?? Infinity)) * 100) / 100;
  return best;
}

/** Why a driver can no longer run an assigned route (null when still fine). */
export function driverBlocker(route, { profiles = [], vehicles = [] }) {
  const p = profiles.find((x) => x.uid === route.driverId);
  if (!p) return "ملف السائق غير موجود";
  if (p.accountStatus && p.accountStatus !== "active") return "حساب السائق غير مفعّل";
  if (p.shiftStatus !== "on_shift") return `السائق ${p.fullName || ""} خارج المناوبة`.trim();
  if (p.availability === "unavailable") return `السائق ${p.fullName || ""} غير متاح`.trim();
  const v = vehicles.find((x) => x.id === (route.vehicleId || p.vehicleId));
  if (!v) return "لا مركبة صالحة للجولة";
  if (!isUsableVehicle(v)) return `المركبة ${v.vehicleNumber || ""} ${v.status === "maintenance" ? "في الصيانة" : "غير متصلة"}`.replace("  ", " ");
  return null;
}

/**
 * @param {object} state  { municipalityId, neighborhoods, bins, readingsByBin, contextFor, profiles, vehicles, routes, incidents, depot }
 * @param {object} settings  merged with DEFAULT_DISPATCH_SETTINGS
 * @param {{now?: number}} [opts]
 */
export function planDispatch(state, settings = {}, { now = Date.now() } = {}) {
  const S = { ...DEFAULT_DISPATCH_SETTINGS, ...settings };
  const { municipalityId: mid, neighborhoods = [], bins = [], readingsByBin = {}, contextFor = () => ({}), profiles = [], vehicles = [], incidents = [] } = state;
  const depot = state.depot?.lat != null ? state.depot : null;
  const routes = (state.routes || []).map((r) => ({ ...r, orderedStops: [...(r.orderedStops || [])], binIds: [...(r.binIds || [])] })); // working copies
  const actions = [];
  const binById = new Map(bins.map((b) => [b.id, b]));
  const nName = (nid) => neighborhoods.find((n) => n.id === nid)?.name || "";
  const bucketOf = (b) => b.lastCollectionAt || "never";

  // ── 1. Score.
  const scored = bins.map((bin) => {
    const priority = getBinPriority(bin, null, readingsByBin[bin.id] || [], contextFor(bin));
    return { bin, priority, eligibility: getRouteEligibility(bin, priority) };
  });
  const active = () => routes.filter((r) => ACTIVE_ROUTE_STATUSES.includes(r.status));
  const lockedIds = () => new Set(active().flatMap((r) => pendingStops(r).map((s) => s.binId)));
  let locked = lockedIds();

  // ── 2. Exceptions that a human must decide.
  const exceptionIds = new Set();
  const sensorByNeighborhood = {};
  for (const s of scored) {
    if (locked.has(s.bin.id)) continue;
    const temp = Number(s.bin.lastTemperatureCelsius);
    if (Number.isFinite(temp) && temp >= THRESHOLDS.tempCriticalC) {
      exceptionIds.add(s.bin.id);
      actions.push({ type: "escalate", kind: "thermal", key: `esc_thermal_${s.bin.id}_${stableHash(bucketOf(s.bin))}`, binIds: [s.bin.id], neighborhoodId: s.bin.neighborhoodId,
        reason: `${s.bin.name}: درجة الحرارة ${Math.round(temp)}°م (الحد ${THRESHOLDS.tempCriticalC}°م) — لا تُجمع بمكبس قبل تقييم خطر الحريق`, suggestion: "افتح التنبيهات الحرارية وطبّق البروتوكول، ثم أسند يدويًا عند الأمان" });
    } else if ((s.priority.tier === "critical" || s.priority.tier === "high") && !s.eligibility.eligible) {
      exceptionIds.add(s.bin.id);
      (sensorByNeighborhood[s.bin.neighborhoodId || "none"] ||= []).push(s);
    }
  }
  // One escalation per neighborhood (a silent area is one problem, not N alerts).
  for (const [nid, list] of Object.entries(sensorByNeighborhood)) {
    const ids = list.map((x) => x.bin.id).sort();
    const reasons = [...new Set(list.map((x) => x.eligibility.reason))];
    actions.push({ type: "escalate", kind: "sensor", key: `esc_sensor_${nid}_${stableHash(list.map((x) => `${x.bin.id}:${bucketOf(x.bin)}`).sort().join(","))}`, binIds: ids, neighborhoodId: nid === "none" ? null : nid,
      reason: `${nName(nid) || "حي غير محدد"}: ${list.length} حاوية حرجة/مرتفعة لا تُسند تلقائيًا — ${reasons.join("؛ ")} (${list.slice(0, 4).map((x) => x.bin.name).join("، ")}${list.length > 4 ? "…" : ""})`,
      suggestion: "تحقق من اتصال المستشعرات ميدانيًا، أو أضف الحاويات يدويًا إلى جولة قريبة" });
  }

  // ── 2b. Re-evaluate routes already assigned — existing commitments come BEFORE new routes,
  //        so a driver freed this cycle is first offered to a route that already lost its driver.
  const releasedIds = new Set();
  for (const r of routes.filter((x) => x.status === "approved" && x.driverId)) {
    const blocker = driverBlocker(r, { profiles, vehicles });
    const ageMin = r.approvedAt ? Math.round((now - new Date(r.approvedAt).getTime()) / 60000) : null;
    if (!blocker) {
      if (ageMin != null && ageMin > S.notStartedEscalateMin) actions.push({ type: "escalate", kind: "not_started", key: `esc_not_started_${r.id}_${r.driverId}`, routeId: r.id, binIds: r.binIds || [], reason: `${r.routeName}: معتمدة منذ ${ageMin} د ولم تبدأ (الحد ${S.notStartedEscalateMin} د) — ${r.driverName || "السائق"}`, suggestion: "تواصل مع السائق أو أعد الإسناد" });
      continue;
    }
    const isAuto = r.dispatch?.auto === true;
    const rec = rankDriverCandidates(r, { profiles: profiles.filter((p) => p.uid !== r.driverId), vehicles, routes: active().filter((x) => x.id !== r.id), neighborhoodName: nName(r.neighborhoodIds?.[0]), defaultOrigin: depot, now });
    const top = rec.recommended;
    const ok = top && !top.capacityShortfall && (top.approachMin == null || top.approachMin <= S.maxApproachMin);
    const fromDriverId = r.driverId;
    if (isAuto && ok) {
      actions.push({ type: "reassign", key: `rea_${r.id}_${fromDriverId}`, routeId: r.id, routeName: r.routeName, binIds: r.binIds || [], fromDriverId, fromDriverName: r.driverName || "", driverId: top.driverId, driverName: top.driverName, vehicleId: top.vehicleId, vehicleNumber: top.vehicleNumber, approachMin: top.approachMin,
        reason: `${blocker} ← أُعيد إسناد ${r.routeName} إلى ${top.driverName}: ${top.reason}` });
      Object.assign(r, { driverId: top.driverId, driverName: top.driverName, vehicleId: top.vehicleId }); // the new driver now holds this route
    } else {
      if (isAuto) {
        actions.push({ type: "release", key: `rel_${r.id}_${fromDriverId}`, routeId: r.id, routeName: r.routeName, binIds: r.binIds || [], fromDriverId, reason: `${blocker} ولا بديل مؤهل — أُعيدت الجولة إلى «مقترحة»` });
        r.status = "suggested"; (r.binIds || []).forEach((id) => releasedIds.add(id));
      }
      actions.push({ type: "escalate", kind: "driver_unavailable", key: `esc_driver_unavailable_${r.id}_${fromDriverId}`, routeId: r.id, binIds: r.binIds || [], reason: `${r.routeName}: ${blocker}${isAuto ? "" : " (إسناد بشري — لا يُغيَّر تلقائيًا)"}`,
        suggestion: top ? `البديل المقترح: ${top.driverName} (${top.reason})` : "لا بديل داخل البلدية — اطلب دعمًا من الأمانة" });
    }
  }
  for (const r of routes.filter((x) => x.status === "in_progress")) {
    const v = vehicles.find((x) => x.id === r.vehicleId);
    const breakdown = incidents.find((i) => i.routeId === r.id && i.status === "open" && /breakdown|vehicle|عطل/.test(String(i.type)));
    if ((v && !isUsableVehicle(v)) || breakdown) actions.push({ type: "escalate", kind: "vehicle_down", key: `esc_vehicle_down_${r.id}_${r.vehicleId || "none"}`, routeId: r.id, binIds: pendingStops(r).map((s) => s.binId),
      reason: `${r.routeName}: ${breakdown ? "بلاغ عطل مفتوح من السائق" : `المركبة ${v?.vehicleNumber || ""} ${v?.status === "maintenance" ? "في الصيانة" : "غير متصلة"}`} — ${pendingStops(r).length} توقف متبقٍ`, suggestion: "انقل التوقفات المتبقية إلى سائق آخر أو مركبة بديلة" });
  }
  locked = lockedIds();

  const needs = scored.filter((s) => s.eligibility.eligible && !locked.has(s.bin.id) && !exceptionIds.has(s.bin.id) && !releasedIds.has(s.bin.id))
    .sort((a, b) => b.priority.score - a.priority.score);

  // ── 3. Insert into existing routes first.
  const insertedIds = new Set();
  const targetRoutes = active().filter((r) => r.driverId && (r.status === "approved" || (S.allowInsertInProgress && r.status === "in_progress")) && !driverBlocker(r, { profiles, vehicles }));
  for (const s of needs) {
    let best = null;
    for (const r of targetRoutes) {
      const pend = pendingStops(r);
      if (pend.length === 0 || pend.length >= S.maxStopsPerRoute) continue;
      const v = vehicles.find((x) => x.id === r.vehicleId);
      const cap = Number(v?.capacityLiters) || null;
      const load = Number(r.estimatedWasteLiters) || 0;
      if (cap != null && load + binWaste(s.bin) > cap) continue;
      const sameNeighborhood = (r.neighborhoodIds || []).includes(s.bin.neighborhoodId);
      const ins = cheapestInsertion(r, s.bin);
      if (!ins) continue;
      if (!sameNeighborhood && (ins.nearestKm == null || ins.nearestKm > S.insertMaxKm)) continue;
      if (ins.addedMin > S.insertMaxAddedMin) continue;
      if (!best || ins.addedMin < best.ins.addedMin) best = { route: r, ins, cap, load };
    }
    if (!best) continue;
    const { route: r, ins, cap, load } = best;
    const stop = { binId: s.bin.id, binName: s.bin.name, priorityTier: s.priority.tier, priorityScore: s.priority.score, hasCoords: true, lat: s.bin.lat, lng: s.bin.lng, fillLevelPercent: s.bin.lastFillLevelPercent ?? null, insertedBy: "auto-dispatch" };
    actions.push({ type: "insert", key: `ins_${r.id}_${s.bin.id}_${stableHash(bucketOf(s.bin))}`, routeId: r.id, routeName: r.routeName, driverId: r.driverId, driverName: r.driverName || "", binIds: [s.bin.id], stop, position: ins.position,
      detourKm: ins.detourKm, addedMin: ins.addedMin, wasteLiters: binWaste(s.bin),
      reason: `${s.bin.name} (${s.priority.reasons[0] || s.priority.tier}) تُضاف إلى ${r.routeName} لـ${r.driverName || "السائق"}: انحراف ${ins.detourKm} كم ≈ +${ins.addedMin} د${cap ? ` · الحمولة ${load + binWaste(s.bin)}/${cap} لتر` : ""}` });
    // apply to the working copy so later inserts see it
    r.orderedStops.splice(ins.position, 0, stop);
    r.orderedStops = r.orderedStops.map((x, i) => ({ ...x, order: i + 1 }));
    r.binIds = r.orderedStops.map((x) => x.binId);
    r.estimatedWasteLiters = load + binWaste(s.bin);
    insertedIds.add(s.bin.id);
  }
  locked = lockedIds();

  // ── 4+5. Group the rest per neighborhood and assign.
  const remaining = needs.filter((s) => !insertedIds.has(s.bin.id));
  const proposals = recommendRoutes(neighborhoods, remaining.map(({ bin, priority }) => ({ bin, priority })));
  for (const prop of proposals) {
    const nid = prop.neighborhoodIds?.[0];
    const propBins = prop.binIds.map((id) => binById.get(id)).filter(Boolean);
    const urgent = propBins.filter((b) => Number(b.lastFillLevelPercent) >= S.urgentFillPct && Number(b.lastFillLevelPercent) <= 100);
    if (propBins.length < S.minBinsPerRoute && urgent.length === 0) {
      actions.push({ type: "defer", key: `def_${nid}_${stableHash(prop.binIds.slice().sort().join(","))}`, neighborhoodId: nid, binIds: prop.binIds,
        reason: `${nName(nid)}: ${propBins.length} حاوية فقط (الحد الأدنى للجولة الاعتيادية ${S.minBinsPerRoute}) ولا حاوية عاجلة ≥ ${S.urgentFillPct}% — تُجمع في الدورة التالية` });
      continue;
    }
    const stops = prop.orderedStops.map((st) => { const b = binById.get(st.binId) || {}; return { ...st, lat: b.lat ?? null, lng: b.lng ?? null, fillLevelPercent: b.lastFillLevelPercent ?? null, wasteLiters: binWaste(b) }; })
      .slice(0, S.maxStopsPerRoute);
    const capped = prop.binIds.length - stops.length;
    const waste = stops.reduce((a, x) => a + x.wasteLiters, 0);
    const rec = rankDriverCandidates({ ...prop, orderedStops: stops, estimatedWasteLiters: waste }, { profiles, vehicles, routes: active(), neighborhoodName: nName(nid), defaultOrigin: depot, now });
    const top = rec.recommended;
    const key = `new_${mid}_${nid}_${stableHash(stops.map((x) => `${x.binId}:${bucketOf(binById.get(x.binId) || {})}`).sort().join(","))}`;
    const alternatives = rec.candidates.filter((c) => c.profile.uid !== top?.driverId).slice(0, 3).map((c) => ({ driverId: c.profile.uid, driverName: c.profile.fullName, eligible: c.verdict.eligible, approachMin: c.approachMin, why: (c.verdict.eligible ? c.flags : c.reasons).join("، ") || "تقييم أقل" }));
    const escalateWith = (kind, reason) => actions.push({ type: "escalate", kind, key: `esc_${kind}_${key}`, neighborhoodId: nid, binIds: stops.map((x) => x.binId), reason, alternatives,
      suggestion: kind === "no_driver" ? "أسند يدويًا بمبرر، أو اطلب دعمًا من الأمانة (نقل الموارد يتطلب اعتمادها)" : kind === "capacity" ? "قسّم الجولة أو أضف رحلة تفريغ" : "راجع موقع السائقين أو أسند يدويًا",
      proposal: { routeName: `جولة تلقائية - ${nName(nid)}`, stops: stops.length, wasteLiters: waste } });
    if (!top) { escalateWith("no_driver", `${nName(nid)}: ${stops.length} حاوية تحتاج جولة — ${rec.warnings[0] || "لا سائق مؤهل"}`); continue; }
    if (top.capacityShortfall) { escalateWith("capacity", `${nName(nid)}: حمولة الجولة ${waste} لتر تتجاوز السعة المتبقية لكل مركبة مؤهلة`); continue; }
    if (top.approachMin != null && top.approachMin > S.maxApproachMin) { escalateWith("too_far", `${nName(nid)}: أقرب سائق مؤهل (${top.driverName}) يحتاج ${top.approachMin} د للوصول، والحد ${S.maxApproachMin} د`); continue; }
    const vehicle = vehicles.find((v) => v.id === top.vehicleId);
    const start = depot || (vehicle?.depotLat != null ? { lat: vehicle.depotLat, lng: vehicle.depotLng } : null);
    const opt = start ? optimizeRoute({ start, stops, capacityLiters: Number(vehicle?.capacityLiters) || null }) : { ok: false };
    const served = opt.ok ? opt.orderedStops.filter((o) => o.type === "stop") : stops;
    const ordered = served.map((o, i) => ({ order: i + 1, binId: o.binId, binName: o.binName, priorityTier: o.priorityTier, priorityScore: o.priorityScore ?? null, hasCoords: o.lat != null, lat: o.lat ?? null, lng: o.lng ?? null, fillLevelPercent: o.fillLevelPercent ?? null, arrivalMin: o.arrivalMin ?? null }));
    const deferredIds = opt.ok ? opt.deferredStops.map((d) => d.binId) : [];
    const routeDoc = {
      routeName: `جولة تلقائية - ${nName(nid)}`, municipalityId: mid, neighborhoodIds: [nid], binIds: ordered.map((o) => o.binId), orderedStops: ordered,
      priorityTier: prop.priorityTier, totalPriorityScore: prop.totalPriorityScore, reasons: prop.reasons,
      estimatedDistanceKm: opt.ok ? opt.totalDistanceKm : prop.estimatedDistanceKm, estimatedDurationMin: opt.ok ? opt.totalDurationMin : null,
      estimatedWasteLiters: ordered.reduce((a, o) => a + binWaste(binById.get(o.binId) || {}), 0),
      optimization: opt.ok ? { matrixSource: opt.matrixSource, confidence: opt.confidence, deferredBinIds: deferredIds, constraints: opt.constraints } : null,
    };
    actions.push({ type: "create_assign", key, neighborhoodId: nid, binIds: routeDoc.binIds, route: routeDoc, urgent: urgent.length > 0,
      driverId: top.driverId, driverName: top.driverName, vehicleId: top.vehicleId, vehicleNumber: top.vehicleNumber, approachMin: top.approachMin, travelSource: top.travelSource, score: top.score, confidence: top.confidence,
      alternatives, nearestOverridden: top.nearestOverridden || null,
      reason: `${routeDoc.routeName}: ${routeDoc.binIds.length} حاوية (${prop.reasons.slice(0, 2).join("، ")})${urgent.length ? ` — عاجلة: ${urgent.map((b) => b.name).join("، ")}` : ""} ← ${top.driverName} على ${top.vehicleNumber}: ${top.reason}${capped > 0 ? ` · ${capped} حاوية فوق حد التوقفات تُترك للدورة التالية` : ""}${deferredIds.length ? ` · ${deferredIds.length} مؤجلة لتجاوز السعة` : ""}` });
    // the chosen driver now holds an active route in the working state
    routes.push({ id: `pending_${key}`, status: "approved", driverId: top.driverId, vehicleId: top.vehicleId, binIds: routeDoc.binIds, orderedStops: ordered, estimatedWasteLiters: routeDoc.estimatedWasteLiters, routeName: routeDoc.routeName, neighborhoodIds: [nid] });
  }

  const count = (t) => actions.filter((a) => a.type === t).length;
  return {
    municipalityId: mid, at: new Date(now).toISOString(), settings: S, actions,
    summary: { binsScored: scored.length, needCollection: needs.length, lockedOnRoutes: locked.size, inserted: count("insert"), created: count("create_assign"), reassigned: count("reassign"), released: count("release"), escalated: count("escalate"), deferred: count("defer"),
      driversFreeNow: profiles.filter((p) => p.shiftStatus === "on_shift" && p.availability !== "unavailable" && (!p.accountStatus || p.accountStatus === "active") && isUsableVehicle(vehicles.find((v) => v.id === p.vehicleId)) && !active().some((r) => r.driverId === p.uid)).length },
  };
}

/** True when every bin an action touches belongs to the demo scene (scope = demo_only). */
export function actionInScope(action, binsById, scope = "demo_only") {
  if (scope === "all") return true;
  const ids = action.binIds || [];
  if (ids.length === 0) return false;
  return ids.every((id) => { const b = binsById.get(id); return !!b && (b.demo === true || b.simulated === true); });
}
