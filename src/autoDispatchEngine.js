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
import { ASSUMPTIONS, DEFAULT_IMPACT_FACTORS } from "./impact.js";
import { routeRemaining } from "./driverState.js";
import { buildAssignmentExplanation, buildInsertionExplanation, buildEscalationExplanation, binFacts, expectedRouteImpact } from "./decisionExplain.js";

export const DISPATCH_MODES = { off: "متوقف", observe: "مراقبة (يحسب ولا ينفذ)", auto: "تنفيذ تلقائي" };
export const DISPATCH_SCOPES = { demo_only: "بيئة العرض فقط (حاويات محاكاة)", all: "كل الحاويات" };

/** Defaults — every number is a setting the authorised admin can change. */
export const DEFAULT_DISPATCH_SETTINGS = {
  mode: "observe",            // off | observe | auto
  scope: "demo_only",         // demo_only | all
  periodMinutes: 15,          // periodic cycle spacing (urgent cases bypass it)
  minBinsPerRoute: 3,         // routine grouping (high-priority / predicted bins): don't send a truck for fewer bins…
  urgentFillPct: THRESHOLDS.fillCriticalPct, // …but a CRITICAL bin (≥ this fill) is handled immediately (urgency policy)
  maxApproachMin: 30,         // a driver further than this (approach time) is not auto-assigned
  maxStopsPerRoute: 18,       // hard cap per route
  insertMaxKm: 1,             // a bin may join an existing route if it is this close to a pending stop…
  insertMaxAddedMin: 15,      // …and the detour + service adds at most this many minutes
  allowInsertInProgress: true,
  useRoadNetwork: true,       // approach time over the road network (OSRM); falls back to a labelled estimate
  notStartedEscalateMin: 90,  // an approved route not started after this long is escalated
  allowNextRouteReservation: true, // a driver on an in-progress route may be reserved for the next route…
  reserveNextWithinMin: 30,   // …if they are expected to finish it within this many minutes
  tzOffsetMin: 180,           // shift times on profiles are local (Buraidah, UTC+3)
  targets: null,              // operational targets — merged with DEFAULT_TARGETS
  impactFactors: null,        // fuel / emission factors — merged with DEFAULT_IMPACT_FACTORS
};

/**
 * Operational targets set by the decision maker. They are not display numbers: the engine uses them to
 * refuse an insertion that would collect a critical bin later than the target, to flag a decision that
 * misses the target (which then feeds the resource-gap analysis), and the performance panel measures against them.
 */
export const DEFAULT_TARGETS = {
  criticalCollectionMin: 60,   // collect a critical bin within this many minutes of the decision
  onTimePct: 90,               // share of critical bins collected within the target
  maxRouteKm: 40,              // planned distance of a single route
  vehicleUtilizationPct: 75,   // estimated load / vehicle capacity on completed routes
  maxLateBins: 3,              // critical bins over target per day before it counts as a gap
};
export const TARGET_LABELS = {
  criticalCollectionMin: ["الزمن المستهدف لجمع الحاوية الحرجة", "دقيقة"],
  onTimePct: ["نسبة الالتزام بالزمن المستهدف", "%"],
  maxRouteKm: ["الحد المستهدف لمسافة الجولة", "كم"],
  vehicleUtilizationPct: ["نسبة استغلال المركبات المستهدفة", "%"],
  maxLateBins: ["الحد المقبول للحاويات المتأخرة يوميًا", "حاوية"],
};
export const targetsOf = (settings) => ({ ...DEFAULT_TARGETS, ...((settings && settings.targets) || {}) });
export const impactFactorsOf = (settings) => ({ ...DEFAULT_IMPACT_FACTORS, ...((settings && settings.impactFactors) || {}) });

/** Minutes until a route reaches `position` in its orderedStops (in-progress routes only; null when unknown). */
export function minutesToPosition(route, position, profile = null) {
  if (route.status !== "in_progress") return null;
  const before = (route.orderedStops || []).slice(0, position);
  const partial = { ...route, orderedStops: before, binIds: before.map((s) => s.binId) };
  const from = profile?.lastLocation?.lat != null ? profile.lastLocation : null;
  return routeRemaining(partial, { from }).remainingMin;
}

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
  no_vehicle: "لا توجد مركبة صالحة للسائقين المتاحين",
  out_of_scope: "الحي خارج نطاق السائقين المتاحين",
  routing_failed: "تعذر حساب زمن الوصول",
  driver_unavailable: "سائق جولة معتمدة لم يعد متاحًا",
  vehicle_down: "مركبة جولة جارية متعطلة",
  not_started: "جولة معتمدة لم تبدأ في الوقت المتوقع",
  target_gap: "الإسناد لا يحقق الزمن المستهدف",
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
/**
 * Urgency policy (documented, configurable):
 *   • CRITICAL bin (fill ≥ urgentFillPct, default = THRESHOLDS.fillCriticalPct) → handled in the SAME cycle,
 *     triggered immediately by a critical reading; inserted into a nearby route or sent as its own route.
 *   • HIGH / predicted-soon bins → batched: a new route needs ≥ minBinsPerRoute bins, otherwise they wait
 *     for the next periodic cycle (periodMinutes) or join a passing route.
 *   • Thermal / unreliable-sensor bins → never automatic; escalated to operations.
 *
 * @param {object} [opts.roadTravel]  { [neighborhoodId]: { [driverUid]: {distanceKm, durationMin} } } — real road
 *   approach legs computed by the caller (OSRM). Missing entries fall back to an air-distance estimate.
 * @param {"ok"|"failed"|"skipped"} [opts.routingStatus]
 */
export function planDispatch(state, settings = {}, { now = Date.now(), roadTravel = null, routingStatus = "skipped" } = {}) {
  const S = { ...DEFAULT_DISPATCH_SETTINGS, ...settings };
  const T = targetsOf(S);
  const F = impactFactorsOf(S);
  const reservation = { enabled: S.allowNextRouteReservation !== false, withinMin: S.reserveNextWithinMin };
  const rankCtx = (extra) => ({ profiles, vehicles, incidents, defaultOrigin: depot, now, reservation, tzOffsetMin: S.tzOffsetMin, ...extra });
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
  const scoredById = new Map(scored.map((x) => [x.bin.id, x]));
  const factsFor = (ids) => ids.map((id) => scoredById.get(id)).filter(Boolean).map((x) => binFacts(x.bin, x.priority));
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
    const rec = rankDriverCandidates(r, rankCtx({ profiles: profiles.filter((p) => p.uid !== r.driverId), routes: active().filter((x) => x.id !== r.id), neighborhoodName: nName(r.neighborhoodIds?.[0]) }));
    const top = rec.recommended;
    const ok = top && !top.capacityShortfall && (top.approachMin == null || top.approachMin <= S.maxApproachMin);
    const fromDriverId = r.driverId;
    if (isAuto && ok) {
      actions.push({ type: "reassign", key: `rea_${r.id}_${fromDriverId}`, routeId: r.id, routeName: r.routeName, binIds: r.binIds || [], fromDriverId, fromDriverName: r.driverName || "", driverId: top.driverId, driverName: top.driverName, vehicleId: top.vehicleId, vehicleNumber: top.vehicleNumber, approachMin: top.approachMin,
        reason: `${blocker} ← أُعيد إسناد ${r.routeName} إلى ${top.driverName}: ${top.reason}`,
        explanation: { ...buildAssignmentExplanation({ now, municipalityId: mid, neighborhoodId: r.neighborhoodIds?.[0] || null, neighborhoodName: nName(r.neighborhoodIds?.[0]), binsFacts: factsFor(r.binIds || []), rec: top, evaluation: rec.evaluation, settings: S, routingStatus }),
          decisionType: "REASSIGNMENT", previousDriver: { driverId: fromDriverId, driverName: r.driverName || "", blocker }, trigger: { code: "DRIVER_BLOCKED", binsCount: (r.binIds || []).length, bins: factsFor(r.binIds || []) } } });
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
  const insertTrail = new Map(); // binId → routes considered and why each was not used
  for (const s of needs) {
    let best = null;
    const considered = [];
    const isCritical = Number(s.bin.lastFillLevelPercent) >= S.urgentFillPct && Number(s.bin.lastFillLevelPercent) <= 100;
    for (const r of targetRoutes) {
      const note = (code, extra = {}) => considered.push({ option: "INSERT_EXISTING_ROUTE", routeId: r.id, routeName: r.routeName, driverName: r.driverName || "", feasible: false, codes: [code], ...extra });
      const pend = pendingStops(r);
      if (pend.length === 0 || pend.length >= S.maxStopsPerRoute) { note("ROUTE_STOP_LIMIT"); continue; }
      const v = vehicles.find((x) => x.id === r.vehicleId);
      const cap = Number(v?.capacityLiters) || null;
      const load = Number(r.estimatedWasteLiters) || 0;
      if (cap != null && load + binWaste(s.bin) > cap) { note("ROUTE_CAPACITY", { remainingL: cap - load }); continue; }
      const sameNeighborhood = (r.neighborhoodIds || []).includes(s.bin.neighborhoodId);
      const ins = cheapestInsertion(r, s.bin);
      if (!ins) { note("NO_COORDINATES"); continue; }
      if (!sameNeighborhood && (ins.nearestKm == null || ins.nearestKm > S.insertMaxKm)) { note("ROUTE_TOO_FAR", { nearestKm: ins.nearestKm }); continue; }
      if (ins.addedMin > S.insertMaxAddedMin) { note("DETOUR_TOO_LONG", { addedMin: ins.addedMin }); continue; }
      const etaMin = minutesToPosition(r, ins.position, profiles.find((x) => x.uid === r.driverId));
      if (isCritical && etaMin != null && etaMin + ins.addedMin > T.criticalCollectionMin) { note("INSERT_LATER_THAN_TARGET", { etaMin: etaMin + ins.addedMin }); continue; }
      considered.push({ option: "INSERT_EXISTING_ROUTE", routeId: r.id, routeName: r.routeName, driverName: r.driverName || "", feasible: true, codes: [], addedMin: ins.addedMin });
      if (!best || ins.addedMin < best.ins.addedMin) best = { route: r, ins, cap, load, etaMin: etaMin != null ? etaMin + ins.addedMin : null };
    }
    insertTrail.set(s.bin.id, considered);
    if (!best) continue;
    const { route: r, ins, cap, load, etaMin: insEta } = best;
    const stop = { binId: s.bin.id, binName: s.bin.name, priorityTier: s.priority.tier, priorityScore: s.priority.score, hasCoords: true, lat: s.bin.lat, lng: s.bin.lng, fillLevelPercent: s.bin.lastFillLevelPercent ?? null, insertedBy: "auto-dispatch" };
    actions.push({ type: "insert", key: `ins_${r.id}_${s.bin.id}_${stableHash(bucketOf(s.bin))}`, routeId: r.id, routeName: r.routeName, driverId: r.driverId, driverName: r.driverName || "", binIds: [s.bin.id], stop, position: ins.position,
      detourKm: ins.detourKm, addedMin: ins.addedMin, wasteLiters: binWaste(s.bin),
      reason: `${s.bin.name} (${s.priority.reasons[0] || s.priority.tier}) تُضاف إلى ${r.routeName} لـ${r.driverName || "السائق"}: انحراف ${ins.detourKm} كم ≈ +${ins.addedMin} د${cap ? ` · الحمولة ${load + binWaste(s.bin)}/${cap} لتر` : ""}`,
      explanation: buildInsertionExplanation({ now, municipalityId: mid, route: r, bin: s.bin, priority: s.priority, ins, cap, load, wasteL: binWaste(s.bin), consideredRoutes: insertTrail.get(s.bin.id).filter((c) => c.routeId !== r.id), settings: S, etaMin: insEta }) });
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
  const roadQueries = []; // first stop of every grouped proposal → the caller fetches real road approach times
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
    roadQueries.push({ neighborhoodId: nid, firstStop: stops.find((x) => x.lat != null) || null });
    const rec = rankDriverCandidates({ ...prop, orderedStops: stops, estimatedWasteLiters: waste }, rankCtx({ routes: active(), neighborhoodName: nName(nid), travelByDriver: roadTravel?.[nid] || {} }));
    // What else was studied for these bins: insertion into existing routes, next-route reservation.
    const insertTried = stops.flatMap((x) => insertTrail.get(x.binId) || []);
    const insertAlt = insertTried.length
      ? { option: "INSERT_EXISTING_ROUTE", chosen: false, feasible: false, codes: [...new Set(insertTried.flatMap((c) => c.codes))], routesConsidered: [...new Set(insertTried.map((c) => c.routeName))].slice(0, 5) }
      : { option: "INSERT_EXISTING_ROUTE", chosen: false, feasible: false, codes: ["NO_ACTIVE_ROUTES"], routesConsidered: [] };
    const busyCodes = ["FINISHES_TOO_LATE", "NEXT_ROUTE_ALREADY_RESERVED", "BUSY_ROUTE_NOT_STARTED", "BUSY_ON_ROUTE"];
    const busyStudied = rec.evaluation.excluded.filter((e) => e.codes.some((c) => busyCodes.includes(c)));
    const reserveAlt = (chosenMode) => ({ option: "RESERVE_NEXT_ROUTE", chosen: chosenMode === "next_route", feasible: chosenMode === "next_route" || rec.candidates.some((c) => c.mode === "next_route" && c.verdict.eligible),
      codes: chosenMode === "next_route" ? [] : reservation.enabled ? [...new Set(busyStudied.flatMap((e) => e.codes))] : ["BUSY_ON_ROUTE"], driversStudied: busyStudied.map((e) => e.driverName).slice(0, 5) });
    const escFacts = () => factsFor(stops.map((x) => x.binId));
    const top = rec.recommended;
    // Why nobody qualifies — so the exception names the real blocker.
    const covering = rec.candidates.filter((c) => !c.verdict.reasons.includes("خارج نطاق التغطية"));
    // Among covering drivers who are actually working (active account, on shift, available), is the vehicle the only blocker?
    const working = covering.filter((c) => !c.verdict.reasons.some((r) => /خارج المناوبة|غير متاح|الحساب/.test(r)));
    const vehicleOnly = working.length > 0 && working.every((c) => c.verdict.reasons.length > 0 && c.verdict.reasons.every((r) => /مركبة|المركبة/.test(r)));
    const key = `new_${mid}_${nid}_${stableHash(stops.map((x) => `${x.binId}:${bucketOf(binById.get(x.binId) || {})}`).sort().join(","))}`;
    const alternatives = rec.candidates.filter((c) => c.profile.uid !== top?.driverId).slice(0, 3).map((c) => ({ driverId: c.profile.uid, driverName: c.profile.fullName, eligible: c.verdict.eligible, approachMin: c.approachMin, why: (c.verdict.eligible ? c.flags : c.reasons).join("، ") || "تقييم أقل" }));
    const escalateWith = (kind, reason, constraints = []) => actions.push({ type: "escalate", kind, key: `esc_${kind}_${key}`, neighborhoodId: nid, binIds: stops.map((x) => x.binId), reason, alternatives,
      explanation: { ...buildEscalationExplanation({ now, municipalityId: mid, neighborhoodId: nid, neighborhoodName: nName(nid), kind, binsFacts: escFacts(), evaluation: rec.evaluation, constraints, settings: S }), alternatives: [insertAlt, reserveAlt(null)] },
      need: { binsCount: stops.length, wasteLiters: waste, urgent: urgent.length > 0 },
      suggestion: ({ no_driver: "أسند يدويًا بمبرر، أو اطلب دعمًا من الأمانة (نقل الموارد يتطلب اعتمادها)", out_of_scope: "إسناد استثنائي بمبرر من موظف العمليات، أو حدّث نطاق تغطية سائق", no_vehicle: "اربط مركبة صالحة بسائق مغطٍّ للحي", capacity: "قسّم الجولة أو أضف رحلة تفريغ", routing_failed: "حدّث موقع السائق أو مستودع المركبة، أو أسند يدويًا" })[kind] || "راجع موقع السائقين أو أسند يدويًا",
      proposal: { routeName: `جولة تلقائية - ${nName(nid)}`, stops: stops.length, wasteLiters: waste } });
    if (!top) {
      if (rec.candidates.length > 0 && covering.length === 0) escalateWith("out_of_scope", `${nName(nid)}: ${stops.length} حاوية تحتاج جولة — لا يغطي أي سائق متاح هذا الحي (الإسناد خارج النطاق يحتاج تفويضًا)`);
      else if (vehicleOnly) escalateWith("no_vehicle", `${nName(nid)}: ${stops.length} حاوية تحتاج جولة — السائقون المتاحون للحي بلا مركبة صالحة (${working.map((c) => c.verdict.reasons.join("، ")).slice(0, 2).join(" · ")})`);
      else escalateWith("no_driver", `${nName(nid)}: ${stops.length} حاوية تحتاج جولة — ${rec.warnings[0] || "لا سائق مؤهل"}`);
      continue;
    }
    if (top.approachMin == null) { escalateWith("routing_failed", `${nName(nid)}: لا يمكن حساب زمن وصول ${top.driverName} (لا موقع للسائق ولا مستودع ولا إحداثيات للتوقفات)`); continue; }
    if (top.capacityShortfall) { escalateWith("capacity", `${nName(nid)}: حمولة الجولة ${waste} لتر تتجاوز السعة المتبقية لكل مركبة مؤهلة`, [{ code: "VEHICLE_CAPACITY_L", value: waste, limit: top.remainingL, met: false }]); continue; }
    if (top.approachMin != null && top.approachMin > S.maxApproachMin) { escalateWith("too_far", `${nName(nid)}: أقرب سائق مؤهل (${top.driverName}) يحتاج ${top.approachMin} د للوصول، والحد ${S.maxApproachMin} د`, [{ code: "MAX_APPROACH_MIN", value: top.approachMin, limit: S.maxApproachMin, met: false }]); continue; }
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
    // Expected collection time of each critical bin = arrival at the first stop + its offset along the optimised order.
    const firstArr = ordered.find((o) => o.arrivalMin != null)?.arrivalMin ?? null;
    const urgentIds = new Set(urgent.map((b) => b.id));
    const criticalEtas = ordered.filter((o) => urgentIds.has(o.binId)).map((o) => (top.etaMin != null && o.arrivalMin != null && firstArr != null ? top.etaMin + (o.arrivalMin - firstArr) : top.etaMin));
    const worstCriticalMin = criticalEtas.length && criticalEtas.every((x) => x != null) ? Math.max(...criticalEtas) : null;
    const constraints = [
      { code: "MAX_APPROACH_MIN", value: top.approachMin, limit: S.maxApproachMin, met: top.approachMin <= S.maxApproachMin },
      ...(worstCriticalMin != null ? [{ code: "CRITICAL_TARGET_MIN", value: worstCriticalMin, limit: T.criticalCollectionMin, met: worstCriticalMin <= T.criticalCollectionMin }] : []),
      { code: "MAX_STOPS", value: ordered.length, limit: S.maxStopsPerRoute, met: ordered.length <= S.maxStopsPerRoute },
      ...(top.remainingL != null ? [{ code: "VEHICLE_CAPACITY_L", value: routeDoc.estimatedWasteLiters, limit: top.remainingL, met: routeDoc.estimatedWasteLiters <= top.remainingL }] : []),
      ...(top.shiftKnown ? [{ code: "SHIFT_MINUTES_LEFT", value: top.totalMin, limit: top.shiftMinutesLeft, met: top.totalMin <= top.shiftMinutesLeft }] : []),
      ...(routeDoc.estimatedDistanceKm != null ? [{ code: "ROUTE_KM_TARGET", value: routeDoc.estimatedDistanceKm, limit: T.maxRouteKm, met: routeDoc.estimatedDistanceKm <= T.maxRouteKm }] : []),
    ];
    const explanation = buildAssignmentExplanation({ now, municipalityId: mid, neighborhoodId: nid, neighborhoodName: nName(nid), binsFacts: factsFor(routeDoc.binIds), rec: top, evaluation: rec.evaluation,
      alternatives: [insertAlt, reserveAlt(top.mode), { option: "NEW_ROUTE_AVAILABLE_DRIVER", chosen: top.mode !== "next_route", feasible: rec.candidates.some((c) => c.mode === "now" && c.verdict.eligible), codes: [] }],
      constraints, routingStatus, matrixSource: routeDoc.optimization?.matrixSource || null, impact: expectedRouteImpact(start, ordered, F), settings: S });
    routeDoc.expectedCollectionMin = top.totalMin ?? null;
    routeDoc.expectedFirstArrivalMin = top.etaMin ?? null;
    if (top.mode === "next_route") routeDoc.reservedAfterRouteId = top.afterRouteId;
    actions.push({ type: "create_assign", key, neighborhoodId: nid, binIds: routeDoc.binIds, route: routeDoc, urgent: urgent.length > 0, explanation, targetMissed: constraints.some((c) => c.code === "CRITICAL_TARGET_MIN" && !c.met),
      reservation: top.mode === "next_route" ? { afterRouteId: top.afterRouteId, startAfterMin: top.startAfterMin } : null, etaMin: top.etaMin ?? null, completionMin: top.totalMin ?? null,
      driverId: top.driverId, driverName: top.driverName, vehicleId: top.vehicleId, vehicleNumber: top.vehicleNumber, approachMin: top.approachMin, travelSource: top.travelSource, score: top.score, confidence: top.confidence,
      routingNote: top.travelSource === "osrm" ? "زمن الوصول عبر شبكة الطرق" : routingStatus === "failed" ? "تعذر الاتصال بخدمة المسارات — زمن الوصول تقدير بالمسافة الجوية" : "زمن الوصول تقدير بالمسافة الجوية",
      alternatives, nearestOverridden: top.nearestOverridden || null,
      reason: `${routeDoc.routeName}: ${routeDoc.binIds.length} حاوية (${prop.reasons.slice(0, 2).join("، ")})${urgent.length ? ` — عاجلة: ${urgent.map((b) => b.name).join("، ")}` : ""} ← ${top.driverName} على ${top.vehicleNumber}${top.mode === "next_route" ? ` (جولة تالية بعد ~${top.startAfterMin} د)` : ""}: ${top.reason}${capped > 0 ? ` · ${capped} حاوية فوق حد التوقفات تُترك للدورة التالية` : ""}${deferredIds.length ? ` · ${deferredIds.length} مؤجلة لتجاوز السعة` : ""}` });
    // the chosen driver now holds an active route in the working state
    routes.push({ id: `pending_${key}`, status: "approved", driverId: top.driverId, vehicleId: top.vehicleId, binIds: routeDoc.binIds, orderedStops: ordered, estimatedWasteLiters: routeDoc.estimatedWasteLiters, routeName: routeDoc.routeName, neighborhoodIds: [nid] });
  }

  const count = (t) => actions.filter((a) => a.type === t).length;
  return {
    municipalityId: mid, at: new Date(now).toISOString(), settings: S, actions, roadQueries, routingStatus,
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
