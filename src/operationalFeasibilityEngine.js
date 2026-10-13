/**
 * operationalFeasibilityEngine.js — can the operational plan be carried out under the current constraints?
 * ─────────────────────────────────────────────────────────────────────
 * ONE model of a municipality's operation, used by every component that has to
 * say "this is possible": the resource-gap ladder, the minimum-adjustment search
 * and the server re-check at approval time.
 *
 *   crew      = driver + vehicle, with: when it is free (now / after its current
 *               route / at its shift start), from where, until when (shift end),
 *               how much room is left in the truck, which neighbourhoods it covers
 *               and the routes it is already committed to;
 *   due bins  = bins the dispatch scoring flags for collection (critical bins carry a
 *               deadline = the operational target); bins already on a committed route
 *               are served by that route's timeline;
 *   plan      = per crew an ordered list of segments (committed routes, then new work).
 *
 * A crew timeline is walked stop by stop: travel (road matrix when supplied, otherwise
 * straight-line ÷ urban speed, labelled), service time, load, a dump trip when the load
 * would exceed capacity AND a dump site is defined (never assumed), the return to the
 * depot when the policy requires it, and the shift end. Every limit is a HARD constraint
 * (it makes the plan invalid) or a SOFT one (it only costs) — a hard constraint is never
 * turned into a cost or a warning. Unknown data (capacity, shift, start point) is never
 * read as "fine": the plan becomes unverifiable and the status says why.
 *
 * Statuses
 *   FEASIBLE            a valid plan meeting the service level was found
 *   PROVEN_INFEASIBLE   a lower bound proves no plan of this model can meet the requirement
 *   NO_SOLUTION_FOUND   the search found none, but infeasibility is not proven
 *   TIME_LIMIT          the search stopped at its time limit without a valid plan
 *   INSUFFICIENT_DATA   a plan could exist, but missing data prevents proving it
 *   ERROR               the evaluation failed (reported, never hidden)
 *
 * Pure: no Firestore, no clock other than `now`. Deterministic for a given input.
 * ─────────────────────────────────────────────────────────────────────
 */
import { getBinPriority, getRouteEligibility, haversineDistanceKm } from "./decisionEngine.js";
import { driverOperationalState, pendingRouteStops, DEFAULT_TZ_OFFSET_MIN } from "./driverState.js";
import { driverOrigin } from "./assignmentEngine.js";
import { ACTIVE_ROUTE_STATUSES } from "./fleetEngine.js";
import { ASSUMPTIONS } from "./impact.js";
import { targetsOf, DEFAULT_DISPATCH_SETTINGS } from "./autoDispatchEngine.js";
import { normalizeNeighborhoodName } from "./config.js";

export const FEASIBILITY_ENGINE_VERSION = "feasibility-1.0.0";

export const FEASIBILITY_STATUS = {
  FEASIBLE: "FEASIBLE",
  PROVEN_INFEASIBLE: "PROVEN_INFEASIBLE",
  NO_SOLUTION_FOUND: "NO_SOLUTION_FOUND",
  TIME_LIMIT: "TIME_LIMIT",
  INSUFFICIENT_DATA: "INSUFFICIENT_DATA",
  ERROR: "ERROR",
};
export const FEASIBILITY_STATUS_TEXT = {
  FEASIBLE: "خطة قابلة للتنفيذ",
  PROVEN_INFEASIBLE: "ثبت تعذر تحقيق القيود ضمن النموذج",
  NO_SOLUTION_FOUND: "لم يُعثر على خطة صالحة (التعذر غير مثبت)",
  TIME_LIMIT: "انتهت مهلة البحث دون خطة صالحة",
  INSUFFICIENT_DATA: "البيانات غير كافية لإثبات صلاحية خطة",
  ERROR: "تعذر التقييم بسبب خطأ",
};

/** Constraint catalogue. hard = the plan is invalid when violated; soft = an objective term. */
export const CONSTRAINTS = {
  VEHICLE_CAPACITY:  { hard: true,  text: "عدم تجاوز سعة المركبة" },
  SHIFT_END:         { hard: true,  text: "عدم تجاوز نهاية المناوبة المسجلة" },
  VEHICLE_USABLE:    { hard: true,  text: "عدم استخدام مركبة معطلة أو غير متصلة" },
  DRIVER_ACTIVE:     { hard: true,  text: "السائق مفعّل ومتاح" },
  ON_SHIFT:          { hard: true,  text: "العمل داخل المناوبة" },
  NO_DOUBLE_BOOKING: { hard: true,  text: "عدم إسناد مهمتين متعارضتين للمورد نفسه" },
  COVERAGE:          { hard: true,  text: "الحي ضمن نطاق تغطية السائق المعتمد" },
  MUNICIPALITY_SCOPE:{ hard: true,  text: "المورد ضمن صلاحيات البلدية (أو معار باعتماد)" },
  VEHICLE_TASK:      { hard: true,  text: "توافق المركبة مع نوع المهمة" },
  MAX_STOPS:         { hard: true,  text: "الحد الأقصى لعدد التوقفات في الجولة" },
  NEW_WORK_ALLOWED:  { hard: true,  text: "السائق يستطيع تولي عمل جديد في هذا الوقت" },
  SERVICE_LEVEL:     { hard: false, requirement: true, text: "جمع الحاويات الحرجة ضمن الزمن المستهدف" },
  ALL_DUE_SERVED:    { hard: false, requirement: true, text: "خدمة كل الحاويات المستحقة" },
  DISTANCE:          { hard: false, text: "تقليل المسافة" },
  RESPONSE_TIME:     { hard: false, text: "تقليل زمن الاستجابة" },
  PLAN_CHANGE:       { hard: false, text: "تقليل تغيير الخطة الحالية" },
  LOANS:             { hard: false, text: "تقليل نقل الموارد بين البلديات" },
};
export const MISSING_DATA_TEXT = {
  CAPACITY_UNKNOWN: "سعة المركبة غير مسجلة — لا يمكن إثبات عدم تجاوزها",
  SHIFT_UNKNOWN: "نافذة المناوبة غير مسجلة — لا يمكن إثبات الالتزام بنهايتها",
  ORIGIN_UNKNOWN: "لا موقع مباشر ولا مستودع للمركبة — لا نقطة انطلاق",
  DEPOT_UNKNOWN: "العودة للمستودع مشترطة ولا مستودع مسجل",
  BIN_COORDINATES: "حاوية بلا إحداثيات — لا يمكن حساب زمن الوصول إليها",
  DUMP_SITE_UNKNOWN: "الحمولة تتجاوز السعة ولا نقطة تفريغ معرّفة",
};

/** Policy defaults — every value is adjustable by the operating authority (documented in MINIMUM_ADJUSTMENT_REPORT.md). */
export const DEFAULT_FEASIBILITY_POLICY = {
  minutesPerStop: ASSUMPTIONS.minutesPerStop,     // service time per bin
  avgUrbanSpeedKmh: ASSUMPTIONS.avgUrbanSpeedKmh, // straight-line fallback speed when no road matrix is supplied
  unloadMin: 20,                 // time at a dump site — used only when a dump site is defined
  returnToDepotRequired: false,  // the work must end back at the depot before the shift ends
  allowUnknownCapacity: false,   // false: an unknown capacity makes new work unverifiable
  allowUnknownShift: false,      // false: an unknown shift end makes new work unverifiable
  allowOvertimeMin: 0,           // minutes past the recorded shift end that may be authorised (0 = none)
  nonCriticalWithinMin: null,    // deadline for non-critical due bins (null = served within the plan / shift)
  defaultBinCapacityL: 1100,     // when a bin has no capacity recorded (flagged as an assumption)
  timeLimitMs: 2500,             // search time limit
  maxIterations: 4000,           // local-search move evaluations
};

const r1 = (v) => Math.round(v * 10) / 10;
const keyOf = (name) => normalizeNeighborhoodName(name || "");

// ── travel ─────────────────────────────────────────────────────────────

/**
 * Travel model. With `matrix` ({ ids: [pointId…], durations: min[][], distances: km[][], source }) road values are
 * used for the pairs it contains; every other pair falls back to straight-line distance at the policy speed.
 */
export function makeTravel(policy = DEFAULT_FEASIBILITY_POLICY, matrix = null) {
  const index = matrix?.ids ? new Map(matrix.ids.map((id, i) => [id, i])) : null;
  let fallbacks = 0, roads = 0;
  const fn = (a, b) => {
    if (!a || !b || a.lat == null || b.lat == null) return null;
    if (index && a.id != null && b.id != null && index.has(a.id) && index.has(b.id)) {
      const i = index.get(a.id), j = index.get(b.id);
      const d = matrix.durations?.[i]?.[j], k = matrix.distances?.[i]?.[j];
      if (d != null && d < 1e5) { roads += 1; return { min: d, km: k != null && k < 1e5 ? k : null, source: matrix.source || "osrm" }; }
    }
    fallbacks += 1;
    const km = haversineDistanceKm(a.lat, a.lng, b.lat, b.lng) ?? 0;
    return { min: (km / policy.avgUrbanSpeedKmh) * 60, km, source: "haversine" };
  };
  fn.stats = () => ({ roadPairs: roads, estimatedPairs: fallbacks, source: roads && !fallbacks ? (matrix?.source || "osrm") : roads ? "mixed" : "haversine" });
  return fn;
}

// ── model ──────────────────────────────────────────────────────────────

const HARD_BLOCKERS = { ACCOUNT_INACTIVE: "DRIVER_ACTIVE", DRIVER_UNAVAILABLE: "DRIVER_ACTIVE", OFF_SHIFT: "ON_SHIFT", SHIFT_ENDED: "ON_SHIFT", NO_VEHICLE: "VEHICLE_USABLE", VEHICLE_MISSING: "VEHICLE_USABLE", VEHICLE_FAULT: "VEHICLE_USABLE" };

export function binWasteL(bin, policy = DEFAULT_FEASIBILITY_POLICY) {
  const cap = Number(bin?.capacityLiters) || policy.defaultBinCapacityL;
  return Math.round(cap * Math.max(0, Math.min(100, Number(bin?.lastFillLevelPercent) || 0)) / 100);
}

/** One crew (driver + vehicle) as the feasibility model sees it. */
export function buildCrew(profile, { state, now, policy, settings, vehicleOverride = null, routes = null }) {
  const S = { ...DEFAULT_DISPATCH_SETTINGS, ...(settings || {}) };
  const allRoutes = routes || state.routes || [];
  const vehicle = vehicleOverride || (state.vehicles || []).find((v) => v.id === profile.vehicleId) || null;
  const st = driverOperationalState(profile, { vehicle, routes: allRoutes, incidents: state.incidents || [], now, tzOffsetMin: S.tzOffsetMin ?? DEFAULT_TZ_OFFSET_MIN });
  const blockers = st.codes.filter((c) => HARD_BLOCKERS[c]).map((c) => ({ code: HARD_BLOCKERS[c], reason: c }));
  const commitments = st.activeRoutes
    .sort((a, b) => (a.status === "in_progress" ? -1 : b.status === "in_progress" ? 1 : String(a.approvedAt || a.createdAt || "").localeCompare(String(b.approvedAt || b.createdAt || ""))))
    .map((r) => ({ routeId: r.id, routeName: r.routeName || r.id, status: r.status, auto: r.dispatch?.auto === true, neighborhoodIds: r.neighborhoodIds || [],
      binIds: pendingRouteStops(r).map((s) => s.binId), reservedAfterRouteId: r.dispatch?.reservedAfterRouteId || r.reservedAfterRouteId || null,
      collectedWasteL: r.status === "in_progress" ? (r.orderedStops || []).filter((s) => (r.collectedBinIds || []).includes(s.binId)).reduce((a, s) => a + Math.round(policy.defaultBinCapacityL * Math.min(100, Number(s.fillLevelPercent) || 0) / 100), 0) : 0 }));
  const inProgress = commitments.find((c) => c.status === "in_progress") || null;
  const origin = driverOrigin(profile, vehicle, { now, fallback: null });
  const depot = vehicle?.depotLat != null ? { id: `depot:${vehicle.id}`, lat: vehicle.depotLat, lng: vehicle.depotLng } : state.depot?.lat != null ? { id: "depot:municipality", ...state.depot } : null;
  // Can this crew take NEW work without any adjustment (the dispatch policy in force)?
  let newWork = { allowed: true, afterCommitments: false, reason: null };
  const finishIn = st.finishInMin;
  if (blockers.length) newWork = { allowed: false, reason: blockers[0].reason };
  else if (commitments.length === 0) newWork = { allowed: true };
  else if (inProgress && commitments.length === 1 && S.allowNextRouteReservation !== false && finishIn != null && finishIn <= S.reserveNextWithinMin) newWork = { allowed: true, afterCommitments: true };
  else newWork = { allowed: false, reason: !inProgress ? "BUSY_ROUTE_NOT_STARTED" : commitments.length > 1 ? "NEXT_ROUTE_ALREADY_RESERVED" : "FINISHES_TOO_LATE" };
  return {
    id: profile.uid, driverId: profile.uid, driverName: profile.fullName || profile.uid, municipalityId: profile.municipalityId || state.municipalityId,
    vehicleId: vehicle?.id || null, vehicleNumber: vehicle?.vehicleNumber || null, vehicleTaskTypes: vehicle?.wasteTypes || null,
    capacityL: Number(vehicle?.capacityLiters) || null, state: st.state, blockers,
    shift: { known: st.shift.known, endMin: st.shift.known ? st.shift.minutesLeft : null, startsInMin: st.shift.known ? st.shift.startsInMin : null, label: st.shift.label || null },
    origin: origin ? { id: `origin:${profile.uid}`, lat: origin.lat, lng: origin.lng, source: origin.source } : null,
    depot, coverage: (profile.neighborhoodKeys || []).map(keyOf), coverageAll: profile.coverageAll === true,
    commitments, finishInMin: finishIn, newWork, availableAtMin: 0, startLoadL: inProgress ? inProgress.collectedWasteL : 0,
    loan: null, simulated: !!profile.simulated,
  };
}

/**
 * The operational model of one municipality at `now`.
 * @param {object} state  { municipalityId, neighborhoods, bins, readingsByBin, contextFor, profiles, vehicles, routes, incidents, depot, dumpSites? }
 */
export function buildOperationalModel(state, { now = Date.now(), settings = {}, policy = {}, matrix = null } = {}) {
  const S = { ...DEFAULT_DISPATCH_SETTINGS, ...(settings || {}) };
  const P = { ...DEFAULT_FEASIBILITY_POLICY, ...(policy || {}) };
  const T = targetsOf(S);
  const mid = state.municipalityId;
  const bins = state.bins || [];
  const binsById = new Map(bins.map((b) => [b.id, b]));
  const nById = new Map((state.neighborhoods || []).map((n) => [n.id, n]));
  const contextFor = state.contextFor || (() => ({}));
  const routes = (state.routes || []).filter((r) => ACTIVE_ROUTE_STATUSES.includes(r.status));
  const committedBinIds = new Set(routes.flatMap((r) => pendingRouteStops(r).map((s) => s.binId)));
  const due = [], excluded = [];
  for (const bin of bins) {
    const priority = getBinPriority(bin, null, (state.readingsByBin || {})[bin.id] || [], contextFor(bin));
    const eligibility = getRouteEligibility(bin, priority);
    const fill = Number(bin.lastFillLevelPercent);
    const temp = Number(bin.lastTemperatureCelsius);
    if (Number.isFinite(temp) && temp >= 60 && !committedBinIds.has(bin.id)) { excluded.push({ binId: bin.id, reason: "THERMAL" }); continue; }
    if (!eligibility.eligible && !committedBinIds.has(bin.id)) { if (["critical", "high"].includes(priority.tier)) excluded.push({ binId: bin.id, reason: "SENSOR" }); continue; }
    const critical = fill >= S.urgentFillPct && fill <= 100;
    due.push({ binId: bin.id, name: bin.name || bin.id, neighborhoodId: bin.neighborhoodId || null, neighborhoodKey: keyOf(nById.get(bin.neighborhoodId)?.name), lat: bin.lat ?? null, lng: bin.lng ?? null,
      fill: Number.isFinite(fill) ? fill : null, tier: priority.tier, score: priority.score, critical, wasteL: binWasteL(bin, P), committed: committedBinIds.has(bin.id),
      deadlineMin: critical ? T.criticalCollectionMin : P.nonCriticalWithinMin, hoursToFull: priority.prediction?.predictionAvailable ? priority.prediction.hoursToFull : null, simulated: !!(bin.simulated || bin.demo) });
  }
  const dueById = new Map(due.map((d) => [d.binId, d]));
  // Committed bins that are not "due" by the scoring are still on a route: keep them as points so timelines are complete.
  // Stops of committed routes keep their own coordinates (used when the bin record is not in the snapshot).
  const stopById = new Map(routes.flatMap((r) => (r.orderedStops || []).filter((x) => x.lat != null).map((x) => [x.binId, x])));
  const point = (binId) => {
    const d = dueById.get(binId); if (d) return d;
    const b = binsById.get(binId);
    if (!b) { const st = stopById.get(binId); return st ? { binId, name: st.binName || binId, neighborhoodId: null, neighborhoodKey: null, lat: st.lat, lng: st.lng, fill: Number(st.fillLevelPercent) || null, critical: false, wasteL: Math.round(P.defaultBinCapacityL * Math.min(100, Number(st.fillLevelPercent) || 0) / 100), committed: true, deadlineMin: null, notDue: true } : null; }
    return { binId, name: b.name || binId, neighborhoodId: b.neighborhoodId || null, neighborhoodKey: keyOf(nById.get(b.neighborhoodId)?.name), lat: b.lat ?? null, lng: b.lng ?? null, fill: Number(b.lastFillLevelPercent) || null, critical: false, wasteL: binWasteL(b, P), committed: true, deadlineMin: null, notDue: true };
  };
  const crews = (state.profiles || []).filter((p) => !mid || p.municipalityId === mid).map((p) => buildCrew(p, { state, now, policy: P, settings: S, routes }));
  return {
    municipalityId: mid, now, policy: P, settings: S, targets: T, crews, due, dueById, excluded, point, binsById, routes,
    dumpSites: (state.dumpSites || []).filter((d) => d.lat != null).map((d, i) => ({ id: d.id || `dump:${i}`, ...d })),
    travel: makeTravel(P, matrix), depot: state.depot?.lat != null ? { id: "depot:municipality", ...state.depot } : null,
  };
}

// ── crew timeline ──────────────────────────────────────────────────────

/**
 * Walk one crew's segments. Segments: [{ routeId|null, binIds, startNotBeforeMin?, moved?: Set }].
 * @returns {{ violations, missing, times: Object<binId,min>, finishMin, driveMin, km, overtimeMin, stops, dumpTrips, unverifiable }}
 */
export function evaluateCrewTimeline(crew, segments, model, { optimisticData = false } = {}) {
  const P = model.policy;
  const violations = [], missing = [], times = {};
  const stopsTotal = segments.reduce((a, s) => a + s.binIds.length, 0);
  const newStops = segments.filter((s) => !s.routeId || s.added?.length || s.moved).reduce((a, s) => a + (s.routeId ? (s.added?.length || 0) : s.binIds.length), 0);
  const out = { violations, missing, times, finishMin: crew.availableAtMin, driveMin: 0, km: 0, overtimeMin: 0, stops: stopsTotal, dumpTrips: 0, unverifiable: false };
  if (stopsTotal === 0) return out;
  const v = (code, extra = {}) => violations.push({ code, hard: CONSTRAINTS[code]?.hard !== false, crewId: crew.id, driverName: crew.driverName, ...extra });
  const m = (code, extra = {}) => { if (!optimisticData) { missing.push({ code, crewId: crew.id, driverName: crew.driverName, ...extra }); out.unverifiable = true; } };
  for (const b of crew.blockers) if (newStops > 0 || b.code === "VEHICLE_USABLE" || b.code === "DRIVER_ACTIVE") v(b.code, { reason: b.reason });
  if (newStops > 0 && !crew.newWork.allowed && !crew.newWorkOverride) v("NEW_WORK_ALLOWED", { reason: crew.newWork.reason });
  let t = crew.availableAtMin || 0;
  let pos = crew.origin;
  if (!pos) { m("ORIGIN_UNKNOWN"); if (!optimisticData) return out; pos = model.depot || null; }
  let firstLegFree = !pos; // optimistic only: no start point known → the first leg is not counted (a lower bound)
  let load = crew.startLoadL || 0;
  const cap = crew.capacityL;
  if (cap == null && newStops > 0 && !P.allowUnknownCapacity) m("CAPACITY_UNKNOWN");
  const dump = model.dumpSites[0] || null;
  const travel = model.travel;
  for (const seg of segments) {
    if (seg.startNotBeforeMin != null) t = Math.max(t, seg.startNotBeforeMin);
    if (seg.binIds.length > model.settings.maxStopsPerRoute) v("MAX_STOPS", { routeId: seg.routeId || null, value: seg.binIds.length, limit: model.settings.maxStopsPerRoute });
    for (const binId of seg.binIds) {
      const b = model.point(binId);
      if (!b || b.lat == null) { m("BIN_COORDINATES", { binId }); continue; }
      if (crew.vehicleTaskTypes && b.wasteType && !crew.vehicleTaskTypes.includes(b.wasteType)) v("VEHICLE_TASK", { binId });
      const isNew = !seg.routeId || seg.added?.includes(binId);
      if (isNew && !crew.coverageAll && b.neighborhoodKey && !crew.coverage.includes(b.neighborhoodKey)) v("COVERAGE", { binId, neighborhoodKey: b.neighborhoodKey });
      if (cap != null && load + b.wasteL > cap) {
        if (dump && pos) {
          const toDump = travel(pos, dump);
          t += toDump.min + P.unloadMin; out.driveMin += toDump.min; out.km += toDump.km || 0; out.dumpTrips += 1; load = 0; pos = dump;
          if (b.wasteL > cap) v("VEHICLE_CAPACITY", { binId, value: b.wasteL, limit: cap });
        } else {
          v("VEHICLE_CAPACITY", { binId, routeId: seg.routeId || null, value: load + b.wasteL, limit: cap });
          if (!missing.some((x) => x.code === "DUMP_SITE_UNKNOWN" && x.crewId === crew.id)) missing.push({ code: "DUMP_SITE_UNKNOWN", crewId: crew.id, informational: true });
        }
      }
      const leg = firstLegFree ? { min: 0, km: 0 } : travel(pos, b);
      firstLegFree = false;
      t += leg.min; out.driveMin += leg.min; out.km += leg.km || 0;
      times[binId] = Math.round(t);
      t += P.minutesPerStop; load += b.wasteL; pos = b;
    }
  }
  if (P.returnToDepotRequired) {
    const depot = crew.depot || model.depot;
    if (!depot) m("DEPOT_UNKNOWN");
    else { const back = travel(pos, depot); t += back.min; out.driveMin += back.min; out.km += back.km || 0; }
  }
  out.finishMin = Math.round(t);
  if (crew.shift.endMin != null) {
    const limit = crew.shift.endMin + (crew.allowOvertimeMin ?? P.allowOvertimeMin ?? 0);
    if (t > crew.shift.endMin) out.overtimeMin = Math.round(Math.min(t, limit) - crew.shift.endMin);
    if (t > limit) v("SHIFT_END", { value: Math.round(t), limit: Math.round(limit) });
  } else if (newStops > 0 && !P.allowUnknownShift) m("SHIFT_UNKNOWN");
  out.driveMin = Math.round(out.driveMin); out.km = r1(out.km);
  return out;
}

// ── plans ──────────────────────────────────────────────────────────────

/** The current plan: every crew keeps its committed routes in their current order; nothing new is assigned yet. */
export function basePlan(model) {
  const crews = {};
  for (const c of model.crews) crews[c.id] = c.commitments.map((k) => ({ routeId: k.routeId, binIds: [...k.binIds], added: [], status: k.status }));
  const assigned = new Set(Object.values(crews).flatMap((segs) => segs.flatMap((s) => s.binIds)));
  return { crews, unassigned: model.due.filter((d) => !assigned.has(d.binId)).map((d) => d.binId) };
}

const clonePlan = (p) => ({ crews: Object.fromEntries(Object.entries(p.crews).map(([k, segs]) => [k, segs.map((s) => ({ ...s, binIds: [...s.binIds], added: [...(s.added || [])] }))])), unassigned: [...p.unassigned], meta: p.meta ? { ...p.meta } : undefined });

/** Cost model in "minute-equivalents" — documented policy weights, NOT money. */
export const DEFAULT_COST_WEIGHTS = {
  driveMinute: 1,          // each minute of driving in the plan
  overtimeMinute: 2,       // each authorised minute beyond the recorded shift end
  movedBin: 6,             // a bin taken off the route it was committed to (plan change)
  resequencedRoute: 4,     // a committed route whose stop order changes
  retimedRoute: 4,         // a route started at another time than now (shift timing)
  reservedRoute: 3,        // a next route reserved behind a running one
  vehicleReassigned: 10,   // a vehicle re-linked to another driver
  loanFixed: 30,           // administrative cost of an inter-municipality loan (+ travel both ways)
  extraCrew: 480,          // one extra crew for a shift (simulation only)
};

/**
 * Evaluate a whole plan: hard violations, unverifiable crews, service level, cost and change.
 * @returns {object} evaluation with `key` = lexicographic objective (lower is better)
 */
export function evaluatePlan(model, plan, { optimisticData = false, weights = DEFAULT_COST_WEIGHTS, extraCostUnits = 0 } = {}) {
  const crewById = new Map(model.crews.map((c) => [c.id, c]));
  const perCrew = {};
  const violations = [], missing = [], times = {};
  let driveMin = 0, km = 0, overtimeMin = 0, finishMax = 0, unverifiable = 0;
  const seen = new Map();
  for (const [cid, segs] of Object.entries(plan.crews)) {
    const crew = crewById.get(cid); if (!crew) continue;
    for (const s of segs) for (const id of s.binIds) { if (seen.has(id) && seen.get(id) !== cid) violations.push({ code: "NO_DOUBLE_BOOKING", hard: true, binId: id, crewId: cid }); seen.set(id, cid); }
    const e = evaluateCrewTimeline(crew, segs, model, { optimisticData });
    perCrew[cid] = e;
    violations.push(...e.violations); missing.push(...e.missing.filter((x) => !x.informational));
    Object.assign(times, e.times);
    driveMin += e.driveMin; km += e.km; overtimeMin += e.overtimeMin; if (e.unverifiable) unverifiable += 1;
    if (e.stops) finishMax = Math.max(finishMax, e.finishMin);
  }
  const hard = violations.filter((x) => x.hard);
  const unserved = [], late = [];
  for (const d of model.due) {
    const at = times[d.binId];
    if (at == null) { unserved.push(d.binId); continue; }
    if (d.deadlineMin != null && at > d.deadlineMin) late.push({ binId: d.binId, atMin: at, deadlineMin: d.deadlineMin, lateMin: at - d.deadlineMin, critical: d.critical });
  }
  const lateMin = late.reduce((a, x) => a + x.lateMin, 0);
  const change = plan.meta?.change || { movedBins: 0, resequencedRoutes: 0 };
  const changeUnits = change.movedBins * weights.movedBin + change.resequencedRoutes * weights.resequencedRoute;
  const costUnits = Math.round(driveMin * weights.driveMinute + overtimeMin * weights.overtimeMinute + changeUnits + extraCostUnits);
  const slaMet = unserved.length === 0 && late.length === 0;
  return {
    valid: hard.length === 0 && unverifiable === 0, slaMet, hardViolations: hard, softViolations: violations.filter((x) => !x.hard), missing, unverifiable,
    unserved, late, lateMin, times, perCrew, driveMin: Math.round(driveMin), km: r1(km), overtimeMin, completionMin: finishMax || null,
    costUnits, changeUnits, change,
    // Lexicographic objective: hard constraints → verifiability → service level → cost → change.
    key: [hard.length, unverifiable, unserved.length, late.length, Math.round(lateMin), costUnits, changeUnits],
  };
}

export const compareKeys = (a, b) => { for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = (a[i] ?? 0) - (b[i] ?? 0); if (d !== 0) return d; } return 0; };

// ── search ─────────────────────────────────────────────────────────────

/**
 * Assign the unassigned due bins (and, with `freedoms.redistribute`, re-place committed bins of routes that
 * have not started) to crews, then improve with local search. Deterministic; bounded by time and iterations.
 * freedoms: { resequence: bool, redistribute: bool, insertIntoCommitted: bool }
 */
export function solvePlan(model, startPlan = null, { freedoms = {}, timeLimitMs, maxIterations, optimisticData = false, weights = DEFAULT_COST_WEIGHTS, extraCostUnits = 0, clock = () => Date.now() } = {}) {
  const P = model.policy;
  const limitMs = timeLimitMs ?? P.timeLimitMs, maxIt = maxIterations ?? P.maxIterations;
  const t0 = clock();
  let iterations = 0, timedOut = false;
  // Base freedoms = the dispatch policy in force: insert into a committed route within its detour budget, new work for free crews.
  const F = { resequence: false, redistribute: false, insertIntoCommitted: true, insertMaxAddedMin: model.settings.insertMaxAddedMin, ...freedoms };
  const plan = clonePlan(startPlan || basePlan(model));
  plan.meta = { change: { movedBins: 0, resequencedRoutes: 0 }, ...(plan.meta || {}) };
  const committedOf = new Map(); // binId → original { crewId, routeId }
  for (const c of model.crews) for (const k of c.commitments) for (const id of k.binIds) committedOf.set(id, { crewId: c.id, routeId: k.routeId, status: k.status });
  const eval_ = (p) => evaluatePlan(model, p, { optimisticData, weights, extraCostUnits });
  const recount = (p) => {
    let moved = 0; const reseq = new Set();
    for (const [cid, segs] of Object.entries(p.crews)) for (const s of segs) {
      s.binIds.forEach((id) => { const o = committedOf.get(id); if (o && (o.crewId !== cid || o.routeId !== s.routeId)) moved += 1; });
      if (s.routeId) { const orig = model.crews.find((c) => c.id === cid)?.commitments.find((k) => k.routeId === s.routeId)?.binIds || []; const kept = s.binIds.filter((id) => orig.includes(id)); const origKept = orig.filter((id) => kept.includes(id)); if (kept.join() !== origKept.join()) reseq.add(s.routeId); }
    }
    p.meta.change = { movedBins: moved, resequencedRoutes: reseq.size };
  };
  const out = () => { timedOut = timedOut || clock() - t0 > limitMs; return timedOut || iterations >= maxIt; };

  // Redistribution: committed bins of routes NOT yet started become movable (in-progress routes keep their stops).
  if (F.redistribute) {
    for (const [, segs] of Object.entries(plan.crews)) for (const s of segs) if (s.routeId && s.status === "approved") { plan.unassigned.push(...s.binIds); s.binIds = []; }
  }
  // Each crew may receive one new segment at the end of its timeline.
  for (const c of model.crews) if (!plan.crews[c.id]) plan.crews[c.id] = [];
  for (const c of model.crews) if (!plan.crews[c.id].some((s) => !s.routeId)) plan.crews[c.id].push({ routeId: null, binIds: [], added: [], status: "new", startNotBeforeMin: c.availableAtMin || null });

  const due = (id) => model.dueById.get(id) || model.point(id);
  const order = (ids) => [...ids].sort((a, b) => (Number(due(b)?.critical) - Number(due(a)?.critical)) || ((due(b)?.score ?? 0) - (due(a)?.score ?? 0)) || String(a).localeCompare(String(b)));
  const canTake = (crew, seg) => !seg.routeId ? (crew.newWork.allowed || crew.newWorkOverride) && crew.blockers.length === 0
    : seg.status === "approved" ? (F.redistribute || F.insertIntoCommitted) && crew.blockers.length === 0
    : F.insertIntoCommitted && model.settings.allowInsertInProgress !== false && crew.blockers.length === 0;
  const finishOf = (crew, segs) => evaluateCrewTimeline(crew, segs, model, { optimisticData }).finishMin;
  const tryInsert = (p, binId) => {
    let best = null;
    for (const crew of model.crews) {
      const segs = p.crews[crew.id];
      const before = finishOf(crew, segs);
      for (let si = 0; si < segs.length; si++) {
        const seg = segs[si];
        if (!canTake(crew, seg)) continue;
        for (let pos = 0; pos <= seg.binIds.length; pos++) {
          if (out()) return best;
          iterations += 1;
          const cand = clonePlan(p);
          const s = cand.crews[crew.id][si];
          s.binIds.splice(pos, 0, binId);
          if (s.routeId) { const o = committedOf.get(binId); if (!(o && o.routeId === s.routeId)) s.added.push(binId); }
          cand.unassigned = cand.unassigned.filter((x) => x !== binId);
          recount(cand);
          const e = evaluateCrewTimeline(crew, cand.crews[crew.id], model, { optimisticData });
          const atMin = e.times[binId];
          const d = due(binId);
          const lateMin = d?.deadlineMin != null && atMin != null ? Math.max(0, atMin - d.deadlineMin) : 0;
          let crewHard = e.violations.filter((x) => x.hard).length;
          // A committed route is only extended within its detour budget unless the adjustment frees it.
          if (s.routeId && !F.redistribute && !F.resequence && F.insertMaxAddedMin != null && e.finishMin - before > F.insertMaxAddedMin) crewHard += 1;
          // local objective: no new hard violation, verifiable, lateness, added drive time
          const k = [crewHard, e.unverifiable ? 1 : 0, lateMin, e.driveMin + e.overtimeMin * weights.overtimeMinute + cand.meta.change.movedBins * weights.movedBin];
          if (!best || compareKeys(k, best.k) < 0) best = { k, plan: cand };
        }
      }
    }
    return best;
  };
  // Construction: most urgent first, cheapest feasible insertion.
  for (const binId of order(plan.unassigned)) {
    if (out()) break;
    const b = tryInsert(plan, binId);
    if (b && b.k[0] === 0 && b.k[1] === 0) { Object.assign(plan, b.plan); }
  }
  recount(plan);
  let best = eval_(plan);
  // Local search: relocate each placed movable bin; 2-opt on reorderable segments.
  const reorderable = (seg) => !seg.routeId || F.resequence;
  let improved = true;
  while (improved && !out()) {
    improved = false;
    // relocate
    for (const [cid, segs] of Object.entries(plan.crews)) {
      for (let si = 0; si < segs.length && !out(); si++) {
        const seg = segs[si];
        for (const binId of [...seg.binIds]) {
          if (out()) break;
          const o = committedOf.get(binId);
          const movable = !o || o.routeId === null || (F.redistribute && o.status === "approved") || (F.resequence && seg.routeId === o.routeId);
          if (!movable) continue;
          const without = clonePlan(plan);
          const ws = without.crews[cid][si];
          ws.binIds = ws.binIds.filter((x) => x !== binId); ws.added = (ws.added || []).filter((x) => x !== binId);
          without.unassigned.push(binId);
          const b = tryInsert(without, binId);
          if (!b) continue;
          recount(b.plan);
          const e = eval_(b.plan);
          if (compareKeys(e.key, best.key) < 0) { Object.assign(plan, b.plan); best = e; improved = true; }
        }
      }
    }
    // 2-opt
    for (const [cid, segs] of Object.entries(plan.crews)) {
      for (let si = 0; si < segs.length && !out(); si++) {
        if (!reorderable(segs[si]) || segs[si].binIds.length < 3) continue;
        const n = segs[si].binIds.length;
        for (let i = 0; i < n - 1 && !out(); i++) for (let j = i + 1; j < n && !out(); j++) {
          iterations += 1;
          const cand = clonePlan(plan);
          const s = cand.crews[cid][si];
          s.binIds = s.binIds.slice(0, i).concat(s.binIds.slice(i, j + 1).reverse(), s.binIds.slice(j + 1));
          recount(cand);
          const e = eval_(cand);
          if (compareKeys(e.key, best.key) < 0) { Object.assign(plan, cand); best = e; improved = true; }
        }
      }
    }
  }
  // Drop empty new segments.
  for (const cid of Object.keys(plan.crews)) plan.crews[cid] = plan.crews[cid].filter((s) => s.routeId || s.binIds.length);
  recount(plan);
  best = eval_(plan);
  return { plan, evaluation: best, solver: { iterations, elapsedMs: clock() - t0, timedOut, timeLimitMs: limitMs, maxIterations: maxIt, completed: !timedOut && iterations < maxIt } };
}

// ── proofs ─────────────────────────────────────────────────────────────

/**
 * Lower bounds that PROVE a requirement cannot be met by any plan of this model (with the given crews):
 *   NO_USABLE_CREW          due bins exist and no crew may take new work
 *   UNCOVERED_BIN           a due, unassigned bin is outside every usable crew's coverage
 *   UNREACHABLE_IN_TIME     a critical bin: earliest possible arrival of ANY usable crew (free time + direct travel)
 *                           is later than its deadline — travel times obey the triangle inequality, so no order helps
 *   CAPACITY_TOTAL          total due waste exceeds the total remaining capacity and no dump site is defined
 *   WORKLOAD_TOTAL          total service time alone exceeds the total working time left in every known shift
 */
export function proveInfeasibility(model, { optimisticData = false } = {}) {
  const proofs = [];
  const free = model.due.filter((d) => !d.committed);
  if (free.length === 0) return proofs;
  const usable = model.crews.filter((c) => c.blockers.length === 0 && (c.newWork.allowed || c.newWorkOverride));
  if (usable.length === 0) { proofs.push({ code: "NO_USABLE_CREW", bins: free.length }); return proofs; }
  for (const d of free) {
    if (!usable.some((c) => c.coverageAll || !d.neighborhoodKey || c.coverage.includes(d.neighborhoodKey))) proofs.push({ code: "UNCOVERED_BIN", binId: d.binId, neighborhoodKey: d.neighborhoodKey });
  }
  for (const d of free.filter((x) => x.critical && x.deadlineMin != null && x.lat != null)) {
    let earliest = Infinity;
    for (const c of usable) {
      if (!(c.coverageAll || !d.neighborhoodKey || c.coverage.includes(d.neighborhoodKey))) continue;
      const startAt = c.newWork.afterCommitments ? (c.finishInMin ?? 0) : c.availableAtMin || 0;
      const from = c.newWork.afterCommitments ? null : c.origin;
      if (!from && !optimisticData) continue;
      const leg = from ? model.travel(from, d) : { min: 0 };
      earliest = Math.min(earliest, startAt + (leg?.min ?? 0));
    }
    if (earliest !== Infinity && earliest > d.deadlineMin) proofs.push({ code: "UNREACHABLE_IN_TIME", binId: d.binId, earliestMin: Math.round(earliest), deadlineMin: d.deadlineMin });
  }
  if (!model.dumpSites.length) {
    const caps = usable.map((c) => (c.capacityL == null ? null : c.capacityL - c.startLoadL - c.commitments.reduce((a, k) => a + k.binIds.reduce((x, id) => x + (model.point(id)?.wasteL || 0), 0), 0)));
    if (caps.every((x) => x != null)) {
      const need = free.reduce((a, d) => a + d.wasteL, 0);
      const room = caps.reduce((a, x) => a + Math.max(0, x), 0);
      if (need > room) proofs.push({ code: "CAPACITY_TOTAL", value: need, limit: room });
    }
  }
  const shifts = usable.map((c) => c.shift.endMin);
  if (shifts.every((x) => x != null)) {
    const serviceNeed = free.length * model.policy.minutesPerStop;
    const timeLeft = usable.reduce((a, c) => a + Math.max(0, c.shift.endMin + (model.policy.allowOvertimeMin || 0) - (c.newWork.afterCommitments ? (c.finishInMin ?? 0) : c.availableAtMin || 0)), 0);
    if (serviceNeed > timeLeft) proofs.push({ code: "WORKLOAD_TOTAL", value: serviceNeed, limit: timeLeft });
  }
  return proofs;
}
export const PROOF_TEXT = {
  NO_USABLE_CREW: "لا يوجد طاقم يستطيع تولي عمل جديد",
  UNCOVERED_BIN: "حاوية مستحقة خارج نطاق تغطية كل الطواقم المتاحة",
  UNREACHABLE_IN_TIME: "أبكر وصول ممكن لأي طاقم متاح يتجاوز الزمن المستهدف لحاوية حرجة",
  CAPACITY_TOTAL: "إجمالي حمولة الحاويات المستحقة يتجاوز السعة المتبقية لكل المركبات ولا نقطة تفريغ",
  WORKLOAD_TOTAL: "زمن الخدمة وحده يتجاوز الوقت المتبقي في مناوبات كل الطواقم",
};

// ── feasibility ────────────────────────────────────────────────────────

const CAUSE_ORDER = ["VEHICLE_CAPACITY", "SHIFT_END", "COVERAGE", "VEHICLE_USABLE", "DRIVER_ACTIVE", "ON_SHIFT", "NEW_WORK_ALLOWED", "MAX_STOPS"];
export const DEFICIT_CAUSE_TEXT = {
  CAPACITY: "سعة المركبات غير كافية",
  SHIFT: "انتهاء المناوبات قبل إكمال العمل",
  NO_QUALIFIED_DRIVER: "لا يوجد سائق مؤهل متاح",
  COVERAGE: "الحي خارج نطاق السائقين المتاحين",
  TIME: "لا يمكن الوصول ضمن الزمن المستهدف",
  WORKLOAD: "حجم العمل يتجاوز القدرة المتاحة",
  DATA: "بيانات تشغيلية ناقصة",
  NONE: "لا عجز",
};

/** Primary cause of a deficit, from proofs and the violations the search ran into. */
export function deficitCause(proofs = [], blocked = [], missing = []) {
  const codes = new Set(proofs.map((p) => p.code));
  if (codes.has("NO_USABLE_CREW")) return "NO_QUALIFIED_DRIVER";
  if (codes.has("CAPACITY_TOTAL")) return "CAPACITY";
  if (codes.has("UNCOVERED_BIN")) return "COVERAGE";
  if (codes.has("WORKLOAD_TOTAL")) return "WORKLOAD";
  if (codes.has("UNREACHABLE_IN_TIME")) return "TIME";
  const v = new Set(blocked.map((x) => x.code));
  if (v.has("VEHICLE_CAPACITY")) return "CAPACITY";
  if (v.has("SHIFT_END")) return "SHIFT";
  if (v.has("COVERAGE")) return "COVERAGE";
  if ([...v].some((c) => ["DRIVER_ACTIVE", "ON_SHIFT", "VEHICLE_USABLE", "NEW_WORK_ALLOWED"].includes(c))) return "NO_QUALIFIED_DRIVER";
  if (missing.length) return "DATA";
  return "TIME";
}

const dedupeMissing = (list) => { const seen = new Set(); return list.filter((m) => { const k = `${m.code}|${m.crewId || ""}|${m.binId || ""}`; if (seen.has(k)) return false; seen.add(k); return true; }); };

/** What blocked each unserved bin: the violations of its best (rejected) insertion. */
function blockingViolations(model, plan, unserved, { optimisticData }) {
  const out = [];
  for (const binId of unserved.slice(0, 30)) {
    for (const crew of model.crews) {
      const segs = (plan.crews[crew.id] || []).map((s) => ({ ...s, binIds: [...s.binIds], added: [...(s.added || [])] }));
      let seg = segs.find((s) => !s.routeId);
      if (!seg) { seg = { routeId: null, binIds: [], added: [] }; segs.push(seg); }
      seg.binIds.push(binId);
      const e = evaluateCrewTimeline(crew, segs, model, { optimisticData });
      for (const x of e.violations.filter((y) => y.hard)) out.push({ ...x, forBinId: binId });
    }
  }
  return out;
}

/**
 * Is the current operation feasible? Builds the model, solves the base plan (dispatch policy in force, no
 * adjustment), and classifies the result.
 * @param {object} state  municipality snapshot (see buildOperationalModel)
 * @param {object} [opts] { now, settings, policy, matrix, freedoms, timeLimitMs, model? (prebuilt), plan? (start plan) }
 */
export function evaluateFeasibility(state, opts = {}) {
  const evaluatedAt = new Date(opts.now ?? Date.now()).toISOString();
  try {
    const model = opts.model || buildOperationalModel(state, opts);
    const solved = solvePlan(model, opts.plan || null, { freedoms: opts.freedoms, timeLimitMs: opts.timeLimitMs, clock: opts.clock, extraCostUnits: opts.extraCostUnits || 0, weights: opts.weights });
    const e = solved.evaluation;
    const constraintsEvaluated = Object.entries(CONSTRAINTS).map(([code, c]) => ({ code, hard: !!c.hard, requirement: !!c.requirement, text: c.text }));
    let status, proofs = [], dataGaps = [];
    if (e.valid && e.slaMet) status = FEASIBILITY_STATUS.FEASIBLE;
    else {
      proofs = proveInfeasibility(model);
      if (proofs.length) status = FEASIBILITY_STATUS.PROVEN_INFEASIBLE;
      else {
        // Would the plan be valid if the unknown data were favourable? Then the data, not the operation, is the problem.
        const optimistic = solvePlan(model, opts.plan || null, { freedoms: opts.freedoms, optimisticData: true, timeLimitMs: opts.timeLimitMs, clock: opts.clock });
        if (optimistic.evaluation.valid && optimistic.evaluation.slaMet) {
          status = FEASIBILITY_STATUS.INSUFFICIENT_DATA;
          // Report exactly which data the optimistic plan relies on (strict re-evaluation of that plan).
          dataGaps = evaluatePlan(model, optimistic.plan).missing;
        }
        else if (solved.solver.timedOut) status = FEASIBILITY_STATUS.TIME_LIMIT;
        else status = FEASIBILITY_STATUS.NO_SOLUTION_FOUND;
      }
    }
    const blocked = status === FEASIBILITY_STATUS.FEASIBLE ? [] : blockingViolations(model, solved.plan, e.unserved, {});
    const cause = status === FEASIBILITY_STATUS.FEASIBLE ? "NONE" : status === FEASIBILITY_STATUS.INSUFFICIENT_DATA ? "DATA" : deficitCause(proofs, blocked, [...e.missing, ...dataGaps]);
    const blockedCodes = [...new Set(blocked.map((x) => x.code))].sort((a, b) => CAUSE_ORDER.indexOf(a) - CAUSE_ORDER.indexOf(b));
    const affectedRoutes = [...new Set(Object.values(solved.plan.crews).flatMap((segs) => segs.filter((s) => s.routeId && (s.added?.length)).map((s) => s.routeId)))];
    const affectedResources = Object.entries(solved.plan.crews).filter(([, segs]) => segs.some((s) => !s.routeId && s.binIds.length)).map(([cid]) => cid);
    const travelStats = model.travel.stats();
    const quality = [];
    if (travelStats.estimatedPairs > 0) quality.push({ code: "TRAVEL_ESTIMATED", text: "أزمنة القيادة تقديرية بالمسافة الجوية لبعض الأزواج أو كلها" });
    if (model.due.some((d) => d.simulated)) quality.push({ code: "SIMULATED_READINGS", text: "قراءات امتلاء من بيئة المحاكاة" });
    if (model.excluded.length) quality.push({ code: "BINS_EXCLUDED", text: `${model.excluded.length} حاوية مستبعدة لقرار بشري (حرارة أو مستشعر غير موثوق)` });
    if (model.due.some((d) => !model.binsById.get(d.binId)?.capacityLiters)) quality.push({ code: "BIN_CAPACITY_ASSUMED", text: `سعة بعض الحاويات غير مسجلة — افتُرضت ${model.policy.defaultBinCapacityL} لتر` });
    return {
      engineVersion: FEASIBILITY_ENGINE_VERSION, feasibilityStatus: status, feasible: status === FEASIBILITY_STATUS.FEASIBLE, evaluatedAt, municipalityId: model.municipalityId,
      constraintsEvaluated, violatedConstraints: [...e.hardViolations, ...blocked.filter((b) => !e.hardViolations.some((h) => h.code === b.code && h.crewId === b.crewId))].slice(0, 40),
      blockingConstraintCodes: blockedCodes, proofs, cause, causeText: DEFICIT_CAUSE_TEXT[cause],
      missingData: dedupeMissing([...e.missing, ...dataGaps]), unservedBins: e.unserved, lateBins: e.late, affectedRoutes, affectedResources,
      estimatedCompletionTime: e.completionMin != null ? new Date(new Date(evaluatedAt).getTime() + e.completionMin * 60000).toISOString() : null, completionMin: e.completionMin,
      confidenceOrQualityFlags: quality, travel: travelStats,
      solverStatus: { status: solved.solver.timedOut ? "TIME_LIMIT" : solved.solver.completed ? "COMPLETED" : "ITERATION_LIMIT", ...solved.solver, algorithm: "priority insertion + relocate / 2-opt local search", version: FEASIBILITY_ENGINE_VERSION },
      demand: { due: model.due.length, critical: model.due.filter((d) => d.critical).length, committed: model.due.filter((d) => d.committed).length, excluded: model.excluded.length, wasteL: model.due.filter((d) => !d.committed).reduce((a, d) => a + d.wasteL, 0) },
      capacity: { crews: model.crews.length, usable: model.crews.filter((c) => c.blockers.length === 0 && c.newWork.allowed).length, byState: model.crews.reduce((a, c) => ({ ...a, [c.state]: (a[c.state] || 0) + 1 }), {}) },
      evaluation: { valid: e.valid, slaMet: e.slaMet, driveMin: e.driveMin, km: e.km, costUnits: e.costUnits, lateMin: e.lateMin, overtimeMin: e.overtimeMin, key: e.key },
      explanation: { status, cause, proofs: proofs.map((p) => p.code), blocking: blockedCodes, missing: [...new Set(e.missing.map((x) => x.code))] },
      plan: solved.plan, model,
    };
  } catch (err) {
    return { engineVersion: FEASIBILITY_ENGINE_VERSION, feasibilityStatus: FEASIBILITY_STATUS.ERROR, feasible: false, evaluatedAt, error: String(err?.message || err), constraintsEvaluated: [], violatedConstraints: [], missingData: [], unservedBins: [], affectedRoutes: [], affectedResources: [], estimatedCompletionTime: null, confidenceOrQualityFlags: [], solverStatus: { status: "ERROR" }, explanation: { status: "ERROR" } };
  }
}

/**
 * Unified check for ONE crew taking a set of bins (used by the resource-gap ladder for every option):
 * capacity, load, drive and service time, start time, shift end, dump time, return to depot, existing commitments.
 * @param {object} state      municipality snapshot
 * @param {object} p          { driverId, binIds, startAfterMin?, vehicleId?, afterCommitments?, overrideNewWork?, profile? (virtual crew) }
 */
export function checkCrewAssignment(state, { driverId, binIds, startAfterMin = null, vehicleId = null, overrideNewWork = false, profile = null, vehicle = null }, { now = Date.now(), settings = {}, policy = {}, matrix = null } = {}) {
  const model = buildOperationalModel(state, { now, settings, policy, matrix });
  let crew = model.crews.find((c) => c.id === driverId);
  if (profile) crew = buildCrew(profile, { state: { ...state, vehicles: [...(state.vehicles || []), ...(vehicle ? [vehicle] : [])] }, now, policy: model.policy, settings: model.settings, routes: model.routes });
  if (!crew) return { feasible: false, violations: [{ code: "DRIVER_ACTIVE", hard: true, reason: "DRIVER_NOT_FOUND" }], missing: [], times: {} };
  if (vehicleId && vehicleId !== crew.vehicleId) {
    const v = (state.vehicles || []).find((x) => x.id === vehicleId);
    crew = buildCrew({ ...(state.profiles || []).find((x) => x.uid === driverId), vehicleId }, { state, now, policy: model.policy, settings: model.settings, routes: model.routes, vehicleOverride: v });
  }
  if (overrideNewWork) crew = { ...crew, newWorkOverride: true, blockers: crew.blockers.filter((b) => !(b.code === "ON_SHIFT" && startAfterMin != null)) };
  if (startAfterMin != null) crew = { ...crew, availableAtMin: startAfterMin };
  const segs = [...crew.commitments.map((k) => ({ routeId: k.routeId, binIds: [...k.binIds], added: [] })), { routeId: null, binIds: [...binIds], added: [], startNotBeforeMin: startAfterMin }];
  const e = evaluateCrewTimeline(crew, segs, model);
  const hard = e.violations.filter((v) => v.hard);
  const lastBin = binIds.map((id) => e.times[id]).filter((x) => x != null);
  return { feasible: hard.length === 0 && !e.unverifiable, violations: hard, missing: e.missing.filter((x) => !x.informational), times: e.times, finishMin: e.finishMin, worstMin: lastBin.length ? Math.max(...lastBin) : null,
    firstMin: lastBin.length ? Math.min(...lastBin) : null, driveMin: e.driveMin, km: e.km, overtimeMin: e.overtimeMin, travel: model.travel.stats() };
}

export const constraintText = (code) => CONSTRAINTS[code]?.text || MISSING_DATA_TEXT[code] || PROOF_TEXT[code] || code;
