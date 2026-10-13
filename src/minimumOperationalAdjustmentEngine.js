/**
 * minimumOperationalAdjustmentEngine.js — the smallest operational change that restores the service level.
 * ─────────────────────────────────────────────────────────────────────
 * When the current plan cannot meet the service level (operationalFeasibilityEngine
 * says so), this engine answers: what is the deficit, which adjustments are
 * allowed, what does each cost, what does it do to the other routes, and which
 * is the least costly VALID one within the search scope.
 *
 * Method (documented in MINIMUM_ADJUSTMENT_REPORT.md):
 *   1. Interventions are generated from the model by a REGISTRY of types (each with
 *      its authority, its resources and its documented cost). New types register
 *      without changing the search.
 *   2. Every SET of up to `maxCombination` compatible interventions (no resource used
 *      twice) is applied to an isolated copy of the model and the plan is re-solved
 *      with the same feasibility engine (insertion + local search).
 *   3. Sets are compared lexicographically:
 *        hard constraints → verifiable data → service level (unserved, late) →
 *        operational cost (minute-equivalents, documented weights) → plan change → size.
 *      A hard constraint is never traded for cost.
 *   4. A loan is valid only if the LENDING municipality still meets its own service level
 *      for the whole loan window with all the loans of the set removed.
 *   5. The search stops at its time limit; the result says whether every set in scope was
 *      evaluated. It never claims a global optimum: the best VALID set found in scope.
 *
 * Pure: no Firestore. Money appears only from documented cost rates (or, in the
 * simulation environment, from clearly labelled simulation factors).
 * ─────────────────────────────────────────────────────────────────────
 */
import { buildOperationalModel, buildCrew, solvePlan, evaluatePlan, evaluateFeasibility, explainUnserved, compareKeys, DEFAULT_COST_WEIGHTS, DEFAULT_FEASIBILITY_POLICY, FEASIBILITY_STATUS, CONSTRAINTS, MISSING_DATA_TEXT, DEFICIT_CAUSE_TEXT, constraintText } from "./operationalFeasibilityEngine.js";
import { loanWindow, isFree } from "./resourceReservations.js";
import { stableHash } from "./autoDispatchEngine.js";
import { ASSUMPTIONS } from "./impact.js";
import { pendingRouteStops } from "./driverState.js";

export const ADJUSTMENT_ENGINE_VERSION = "min-adjustment-1.0.0";
export const ROLE_RANK = { employee: 1, manager: 2, executive: 3 };
export const AUTHORITY_TEXT = { employee: "موظف العمليات", manager: "مدير البلدية", executive: "الأمانة" };

export const DEFAULT_ADJUSTMENT_POLICY = {
  allowed: { RESEQUENCE: true, REDISTRIBUTE: true, SHIFT_TIMING: true, RESERVE_NEXT: true, IDLE_VEHICLE: true, OVERTIME: false, LOAN: true, ADD_RESOURCE: true },
  maxCombination: 2,              // interventions per set
  timeLimitMs: 6000,              // whole search
  perSetTimeLimitMs: 700,         // one re-solve
  shiftTimingHorizonMin: 120,     // a covering driver whose shift starts within this may be scheduled at its start
  overtimeMin: 30,                // authorised overtime when OVERTIME is allowed
  loanDurationMin: 240,           // work time of a lent crew at the receiver (window = 2 × travel + this)
  maxLoanTravelMin: 45,
  weights: DEFAULT_COST_WEIGHTS,
  costRates: null,                // documented money rates { perDriveMinute, perOvertimeMinute, loanFixed, extraCrewShift, currency, source }
  useSimulationCostRates: true,   // only applied when every due bin is simulated
};

/** Money factors for the SIMULATION environment only — derived from the announced assumptions in impact.js. */
export const SIMULATION_COST_RATES = {
  perDriveMinute: Math.round((ASSUMPTIONS.crewCostPerHour / 60 + (ASSUMPTIONS.avgUrbanSpeedKmh / 60) * ASSUMPTIONS.truckFuelLitersPerKm * ASSUMPTIONS.fuelPricePerLiter) * 100) / 100,
  perOvertimeMinute: Math.round((ASSUMPTIONS.crewCostPerHour / 60) * 1.5 * 100) / 100,
  loanFixed: null, extraCrewShift: Math.round(ASSUMPTIONS.crewCostPerHour * 8),
  currency: "ريال", source: "معامل تجريبي — بيئة المحاكاة فقط (من افتراضات معلنة: تكلفة ساعة الطاقم، استهلاك الوقود، سعر الديزل)", simulation: true,
};

const clone = (x) => JSON.parse(JSON.stringify(x));
const cloneModel = (m) => ({ ...m, crews: m.crews.map((c) => clone(c)) });

// ── intervention registry ──────────────────────────────────────────────

/**
 * Each type: { title, authority, generate(ctx) → [{ key, resources, fixedUnits, components, freedoms?, apply?(model), details, ... }] }
 * `apply` mutates an isolated model copy; `freedoms` widen what the solver may move.
 */
export const INTERVENTION_TYPES = {};
export function registerIntervention(code, def) { INTERVENTION_TYPES[code] = { code, ...def }; }

registerIntervention("RESEQUENCE", {
  title: "إعادة ترتيب توقفات الجولات القائمة", authority: "employee",
  generate: ({ model }) => (model.crews.some((c) => c.commitments.some((k) => k.binIds.length >= 2))
    ? [{ key: "RESEQUENCE", resources: [], fixedUnits: 0, freedoms: { resequence: true }, details: { routes: model.crews.flatMap((c) => c.commitments.filter((k) => k.binIds.length >= 2).map((k) => k.routeId)) } }] : []),
});
registerIntervention("REDISTRIBUTE", {
  title: "إعادة توزيع الحاويات بين الجولات", authority: "employee",
  generate: ({ model }) => (model.crews.some((c) => c.commitments.some((k) => k.status === "approved" && k.binIds.length))
    ? [{ key: "REDISTRIBUTE", resources: [], fixedUnits: 0, freedoms: { redistribute: true, insertMaxAddedMin: null }, details: { routes: model.crews.flatMap((c) => c.commitments.filter((k) => k.status === "approved").map((k) => k.routeId)) } }] : []),
});
registerIntervention("SHIFT_TIMING", {
  title: "جدولة جولة عند بداية مناوبة سائق", authority: "manager",
  generate: ({ model, policy, rejected }) => model.crews.filter((c) => c.blockers.length && c.blockers.every((b) => b.code === "ON_SHIFT" && b.reason === "OFF_SHIFT")).flatMap((c) => {
    if (!c.shift.known) { rejected.push({ code: "SHIFT_TIMING", subject: c.driverName, reason: "نافذة مناوبة السائق غير مسجلة" }); return []; }
    if (!(c.shift.startsInMin > 0 && c.shift.startsInMin <= policy.shiftTimingHorizonMin)) { rejected.push({ code: "SHIFT_TIMING", subject: c.driverName, reason: c.shift.startsInMin <= 0 ? "المناوبة بدأت والسائق غير مسجل كمناوب" : `تبدأ المناوبة بعد ${c.shift.startsInMin} د (خارج أفق ${policy.shiftTimingHorizonMin} د)` }); return []; }
    return [{ key: `SHIFT_TIMING:${c.id}`, resources: [c.id], fixedUnits: policy.weights.retimedRoute, components: [{ code: "retimedRoute", units: policy.weights.retimedRoute }],
      apply: (m) => { const x = m.crews.find((y) => y.id === c.id); x.blockers = []; x.availableAtMin = c.shift.startsInMin; x.newWork = { allowed: true }; x.newWorkOverride = true; },
      details: { driverId: c.id, driverName: c.driverName, startsInMin: c.shift.startsInMin, shift: c.shift.label } }];
  }),
});
registerIntervention("RESERVE_NEXT", {
  title: "حجز جولة لاحقة لسائق ينهي مهمته", authority: "employee",
  generate: ({ model }) => model.crews.filter((c) => c.blockers.length === 0 && !c.newWork.allowed && ["FINISHES_TOO_LATE", "BUSY_ROUTE_NOT_STARTED"].includes(c.newWork.reason)).map((c) => ({
    key: `RESERVE_NEXT:${c.id}`, resources: [c.id], fixedUnits: model.policy.__w.reservedRoute, components: [{ code: "reservedRoute", units: model.policy.__w.reservedRoute }],
    apply: (m) => { const x = m.crews.find((y) => y.id === c.id); x.newWorkOverride = true; x.newWork = { allowed: true, afterCommitments: true }; },
    details: { driverId: c.id, driverName: c.driverName, finishInMin: c.finishInMin, after: c.commitments.map((k) => k.routeName) } })),
});
registerIntervention("IDLE_VEHICLE", {
  title: "تشغيل مركبة متاحة داخل البلدية", authority: "manager",
  generate: ({ model, state, rejected }) => {
    const held = new Set([...model.crews.filter((c) => c.blockers.every((b) => b.code !== "VEHICLE_USABLE")).map((c) => c.vehicleId).filter(Boolean), ...(model.routes || []).map((r) => r.vehicleId).filter(Boolean)]);
    const idle = (state.vehicles || []).filter((v) => v.municipalityId === model.municipalityId && !["maintenance", "offline"].includes(v.status) && !held.has(v.id));
    const blocked = model.crews.filter((c) => c.blockers.length && c.blockers.every((b) => b.code === "VEHICLE_USABLE") && c.commitments.length === 0);
    if (blocked.length && !idle.length) rejected.push({ code: "IDLE_VEHICLE", subject: blocked.map((c) => c.driverName).join("، "), reason: "لا مركبة صالحة غير مسندة في البلدية" });
    return blocked.flatMap((c) => idle.map((v) => ({
      key: `IDLE_VEHICLE:${c.id}:${v.id}`, resources: [c.id, v.id], fixedUnits: model.policy.__w.vehicleReassigned, components: [{ code: "vehicleReassigned", units: model.policy.__w.vehicleReassigned }],
      apply: (m) => {
        const i = m.crews.findIndex((y) => y.id === c.id);
        const profile = (state.profiles || []).find((p) => p.uid === c.id);
        m.crews[i] = buildCrew({ ...profile, vehicleId: v.id }, { state, now: m.now, policy: m.policy, settings: m.settings, routes: m.routes, vehicleOverride: v });
      },
      details: { driverId: c.id, driverName: c.driverName, vehicleId: v.id, vehicleNumber: v.vehicleNumber || v.id, capacityL: Number(v.capacityLiters) || null } })));
  },
});
registerIntervention("OVERTIME", {
  title: "ساعات عمل إضافية مسموحة", authority: "manager",
  generate: ({ model, policy }) => model.crews.filter((c) => c.blockers.length === 0 && c.shift.known).map((c) => ({
    key: `OVERTIME:${c.id}`, resources: [c.id], fixedUnits: 0, components: [],
    apply: (m) => { m.crews.find((y) => y.id === c.id).allowOvertimeMin = policy.overtimeMin; },
    details: { driverId: c.id, driverName: c.driverName, overtimeMin: policy.overtimeMin } })),
});
registerIntervention("LOAN", {
  title: "إعارة طاقم من بلدية أخرى", authority: "executive",
  generate: ({ model, policy, donors, now, rejected, existingReservations }) => {
    const out = [];
    const target = model.due.filter((d) => !d.committed && d.lat != null).sort((a, b) => Number(b.critical) - Number(a.critical))[0];
    if (!target) return out;
    for (const donor of donors || []) {
      const dModel = donor.model;
      for (const c of dModel.crews) {
        const subject = `${c.driverName} (${donor.name || donor.municipalityId})`;
        if (c.blockers.length || c.commitments.length || !c.newWork.allowed) continue;          // only idle, usable crews are lendable
        if (!c.origin) { rejected.push({ code: "LOAN", subject, reason: MISSING_DATA_TEXT.ORIGIN_UNKNOWN }); continue; }
        const leg = model.travel(c.origin, target);
        const travelMin = Math.round(leg.min);
        if (travelMin > policy.maxLoanTravelMin) { rejected.push({ code: "LOAN", subject, reason: `زمن الانتقال ${travelMin} د يتجاوز ${policy.maxLoanTravelMin} د` }); continue; }
        const win = loanWindow({ now, travelMin, taskMin: policy.loanDurationMin });
        if (c.shift.endMin != null && c.shift.endMin < 2 * travelMin + policy.loanDurationMin) { rejected.push({ code: "LOAN", subject, reason: `تنتهي مناوبة السائق قبل نهاية الإعارة والعودة (${c.shift.endMin} د متبقية من ${2 * travelMin + policy.loanDurationMin})` }); continue; }
        const busy = [c.id, c.vehicleId].filter(Boolean).find((id) => !isFree(id, win, existingReservations));
        if (busy) { rejected.push({ code: "LOAN", subject, reason: "المورد محجوز في نافذة متداخلة" }); continue; }
        const units = policy.weights.loanFixed + 2 * travelMin * policy.weights.driveMinute;
        out.push({ key: `LOAN:${donor.municipalityId}:${c.id}`, resources: [c.id, c.vehicleId].filter(Boolean), fixedUnits: units,
          components: [{ code: "loanFixed", units: policy.weights.loanFixed }, { code: "loanTravel", units: 2 * travelMin * policy.weights.driveMinute, minutes: 2 * travelMin }],
          donorMunicipalityId: donor.municipalityId, window: win,
          apply: (m) => { m.crews.push({ ...clone(c), id: c.id, municipalityId: m.municipalityId, coverageAll: true, loan: { from: donor.municipalityId, window: win }, newWorkOverride: true, newWork: { allowed: true } }); },
          details: { driverId: c.id, driverName: c.driverName, vehicleId: c.vehicleId, vehicleNumber: c.vehicleNumber, fromMunicipalityId: donor.municipalityId, fromName: donor.name || donor.municipalityId, travelMin, travelSource: leg.source, window: win } });
      }
    }
    if (!(donors || []).length) rejected.push({ code: "LOAN", subject: "—", reason: "لم تُحمَّل حالة بلديات أخرى للدراسة" });
    return out;
  },
});
registerIntervention("ADD_RESOURCE", {
  title: "إضافة طاقم (موارد إضافية)", authority: "executive",
  generate: ({ model, state, rejected }) => {
    const vd = (state.vehicles || []).find((v) => v.municipalityId === model.municipalityId && v.depotLat != null);
    const start = model.depot || (vd ? { id: "depot:virtual", lat: vd.depotLat, lng: vd.depotLng } : null);
    if (!start) { rejected.push({ code: "ADD_RESOURCE", subject: "طاقم إضافي", reason: "لا مستودع مسجل لنقطة انطلاق الطاقم الإضافي (لا تُفترض نقطة انطلاق)" }); return []; }
    const caps = model.crews.map((c) => c.capacityL).filter(Boolean).sort((a, b) => a - b);
    const shifts = model.crews.filter((c) => c.shift.known).map((c) => c.shift.endMin).sort((a, b) => a - b);
    const cap = caps.length ? caps[Math.floor(caps.length / 2)] : null;
    const endMin = shifts.length ? shifts[Math.floor(shifts.length / 2)] : null;
    return [{ key: "ADD_RESOURCE", resources: ["virtual-crew"], fixedUnits: model.policy.__w.extraCrew, components: [{ code: "extraCrew", units: model.policy.__w.extraCrew }], simulated: true, requiresExternalAction: true,
      apply: (m) => { m.crews.push({ id: "virtual-crew", driverId: null, driverName: "طاقم إضافي (محاكاة)", vehicleId: null, vehicleNumber: "مركبة إضافية (محاكاة)", capacityL: cap, state: "AVAILABLE", blockers: [],
        shift: { known: endMin != null, endMin, startsInMin: null, label: null }, origin: { id: "origin:virtual", lat: start.lat, lng: start.lng, source: "depot" }, depot: start, coverage: [], coverageAll: true,
        commitments: [], finishInMin: null, newWork: { allowed: true }, availableAtMin: 0, startLoadL: 0, simulated: true }); },
      details: { capacityL: cap, shiftEndMin: endMin, start: "مستودع البلدية", basis: cap == null ? "لا سعة مرجعية — غير قابل للإثبات" : "سعة وسيطة لمركبات البلدية ومناوبة وسيطة" } }];
  },
});

// ── helpers ────────────────────────────────────────────────────────────

/** Fingerprint of the inputs an approval depends on — a recommendation computed on another state is stale. */
export function stateFingerprint(state) {
  const bins = (state.bins || []).map((b) => `${b.id}:${Math.round((Number(b.lastFillLevelPercent) || 0) / 5)}`).sort().join(",");
  const routes = (state.routes || []).filter((r) => ["approved", "in_progress"].includes(r.status)).map((r) => `${r.id}:${r.status}:${r.driverId || ""}:${r.vehicleId || ""}:${pendingRouteStops(r).map((s) => s.binId).join("|")}`).sort().join(",");
  const crews = (state.profiles || []).map((p) => `${p.uid}:${p.shiftStatus}:${p.availability}:${p.vehicleId || ""}:${p.municipalityId}:${p.accountStatus || ""}`).sort().join(",");
  const vehicles = (state.vehicles || []).map((v) => `${v.id}:${v.status}:${v.capacityLiters ?? ""}:${v.municipalityId}`).sort().join(",");
  return stableHash([bins, routes, crews, vehicles].join("#"));
}
export const policyVersion = (policy) => `p-${stableHash(JSON.stringify({ ...policy, weights: policy.weights }))}`;

const crewLabel = (model, id) => model.crews.find((c) => c.id === id)?.driverName || id;

/** Route-level comparison of two plans: what changed for the routes that already existed, and new routes. */
export function planDiff(baseModel, basePlanResult, model, plan, evalBase, evalNew) {
  const routeChanges = [];
  const origOf = new Map();
  for (const c of baseModel.crews) for (const k of c.commitments) origOf.set(k.routeId, { crewId: c.id, routeName: k.routeName, binIds: k.binIds });
  const newSegs = [];
  for (const [cid, segs] of Object.entries(plan.crews)) {
    for (const s of segs) {
      if (!s.routeId) { if (s.binIds.length) newSegs.push({ crewId: cid, driverName: crewLabel(model, cid), binIds: s.binIds, loan: model.crews.find((c) => c.id === cid)?.loan || null, simulated: !!model.crews.find((c) => c.id === cid)?.simulated }); continue; }
      const o = origOf.get(s.routeId); if (!o) continue;
      const added = s.binIds.filter((id) => !o.binIds.includes(id));
      const removed = o.binIds.filter((id) => !s.binIds.includes(id));
      const keptNew = s.binIds.filter((id) => o.binIds.includes(id)), keptOld = o.binIds.filter((id) => s.binIds.includes(id));
      const reordered = keptNew.join() !== keptOld.join();
      const delays = keptNew.map((id) => (evalNew.times[id] ?? null) - (evalBase.times[id] ?? null)).filter((x) => Number.isFinite(x));
      if (added.length || removed.length || reordered || delays.some((d) => d > 0)) routeChanges.push({ routeId: s.routeId, routeName: o.routeName, crewId: cid, driverName: crewLabel(model, cid), added, removed, reordered, maxDelayMin: delays.length ? Math.max(0, ...delays) : 0, binIds: s.binIds });
    }
  }
  // Committed routes whose bins all moved away (redistribution) still count as changed.
  for (const [routeId, o] of origOf) if (!routeChanges.some((r) => r.routeId === routeId) && !Object.values(plan.crews).some((segs) => segs.some((s) => s.routeId === routeId && s.binIds.length))) {
    if (o.binIds.length) routeChanges.push({ routeId, routeName: o.routeName, crewId: o.crewId, driverName: crewLabel(baseModel, o.crewId), added: [], removed: o.binIds, reordered: false, maxDelayMin: 0, binIds: [] });
  }
  const neighborhoods = [...new Set([...newSegs.flatMap((s) => s.binIds), ...routeChanges.flatMap((r) => [...r.added, ...r.removed])].map((id) => model.point(id)?.neighborhoodId).filter(Boolean))];
  return { routeChanges, newRoutes: newSegs, neighborhoods };
}

/** Money for a set, only from documented rates (or labelled simulation rates). */
function monetary(evaluation, components, rates) {
  if (!rates) return { value: null, currency: null, text: "التكلفة المالية غير متاحة — لا توجد أسعار موثقة", kind: null };
  let v = 0; const missing = [];
  if (rates.perDriveMinute != null) v += evaluation.driveMin * rates.perDriveMinute; else missing.push("دقيقة القيادة");
  if (evaluation.overtimeMin) { if (rates.perOvertimeMinute != null) v += evaluation.overtimeMin * rates.perOvertimeMinute; else missing.push("الدقيقة الإضافية"); }
  for (const c of components) {
    if (c.code === "extraCrew") { if (rates.extraCrewShift != null) v += rates.extraCrewShift; else missing.push("الطاقم الإضافي"); }
    if (c.code === "loanFixed") { if (rates.loanFixed != null) v += rates.loanFixed; else missing.push("التكلفة الإدارية للإعارة"); }
  }
  if (missing.length) return { value: null, currency: rates.currency || null, text: `التكلفة المالية غير مكتملة — لا سعر موثق لـ: ${missing.join("، ")}`, kind: rates.simulation ? "simulation" : "documented" };
  return { value: Math.round(v), currency: rates.currency || null, text: rates.source || "", kind: rates.simulation ? "simulation" : "documented" };
}

// ── main ───────────────────────────────────────────────────────────────

/**
 * @param {object} state      municipality snapshot (same shape as planDispatch / evaluateFeasibility)
 * @param {object} [opts]
 * @param {number} [opts.now]
 * @param {object} [opts.settings]            dispatch settings (targets…)
 * @param {object} [opts.feasibilityPolicy]   DEFAULT_FEASIBILITY_POLICY overrides
 * @param {object} [opts.policy]              DEFAULT_ADJUSTMENT_POLICY overrides (allowed types, maxCombination, weights, costRates…)
 * @param {Array}  [opts.donors]              [{ municipalityId, name, state }] other municipalities that may lend
 * @param {Array}  [opts.existingReservations] active resource reservations
 * @param {object} [opts.matrix]              road matrix for the receiver's points (optional)
 * @param {()=>number} [opts.clock]
 */
export function analyzeMinimumAdjustment(state, opts = {}) {
  const now = opts.now ?? Date.now();
  const clock = opts.clock || (() => Date.now());
  const t0 = clock();
  const P = { ...DEFAULT_ADJUSTMENT_POLICY, ...(opts.policy || {}), allowed: { ...DEFAULT_ADJUSTMENT_POLICY.allowed, ...(opts.policy?.allowed || {}) }, weights: { ...DEFAULT_COST_WEIGHTS, ...(opts.policy?.weights || {}) } };
  const FP = { ...DEFAULT_FEASIBILITY_POLICY, ...(opts.feasibilityPolicy || {}) };
  const base = evaluateFeasibility(state, { now, settings: opts.settings, policy: FP, matrix: opts.matrix, clock: opts.clock });
  const meta = { engineVersion: ADJUSTMENT_ENGINE_VERSION, feasibilityVersion: base.engineVersion, policyVersion: policyVersion(P), analyzedAt: new Date(now).toISOString(), fingerprint: safe(() => stateFingerprint(state)), municipalityId: safe(() => state.municipalityId) };
  if (base.feasibilityStatus === FEASIBILITY_STATUS.ERROR) return { ...meta, status: "ERROR", needed: null, base: stripBase(base), error: base.error, alternatives: [], rejectedCandidates: [], recommended: null };
  if (base.feasible) return { ...meta, status: "NO_DEFICIT", needed: false, base: stripBase(base), alternatives: [], rejectedCandidates: [], recommended: null, search: null };

  const model = base.model;
  model.policy.__w = P.weights;
  const simulatedEnv = model.due.length > 0 && model.due.every((d) => d.simulated);
  const rates = P.costRates || (simulatedEnv && P.useSimulationCostRates ? SIMULATION_COST_RATES : null);
  const donors = (opts.donors || []).map((d) => ({ ...d, model: buildOperationalModel(d.state, { now, settings: opts.settings, policy: FP }), base: evaluateFeasibility(d.state, { now, settings: opts.settings, policy: FP, clock: opts.clock }) }));

  // 1. candidates
  const rejected = [];
  const candidates = [];
  for (const [code, type] of Object.entries(INTERVENTION_TYPES)) {
    if (!P.allowed[code]) { rejected.push({ code, subject: "—", reason: "غير مسموح بسياسة الجهة" }); continue; }
    for (const c of type.generate({ model, state, policy: P, donors, now, rejected, existingReservations: opts.existingReservations || [] })) {
      candidates.push({ ...c, id: c.key, code, title: type.title, authority: c.authority || type.authority, components: c.components || [] });
    }
  }

  // 2. sets: size 1..k, compatible (no shared resource, one of each global freedom), cheapest fixed cost first.
  const sets = [];
  const k = Math.max(1, Math.min(P.maxCombination, 3));
  const rec = (start, chosen) => {
    if (chosen.length) sets.push(chosen);
    if (chosen.length === k) return;
    for (let i = start; i < candidates.length; i++) {
      const c = candidates[i];
      const used = new Set(chosen.flatMap((x) => x.resources));
      if (c.resources.some((r) => used.has(r))) continue;
      if (chosen.some((x) => x.code === c.code && (c.code === "RESEQUENCE" || c.code === "REDISTRIBUTE" || c.code === "ADD_RESOURCE"))) continue;
      rec(i + 1, [...chosen, c]);
    }
  };
  rec(0, []);
  sets.sort((a, b) => a.length - b.length || a.reduce((x, c) => x + c.fixedUnits, 0) - b.reduce((x, c) => x + c.fixedUnits, 0) || a.map((c) => c.id).join().localeCompare(b.map((c) => c.id).join()));

  // 3. evaluate every set (bounded by the time limit)
  const evaluated = [];
  let timedOut = false;
  const baseEval = evaluatePlan(model, base.plan, { weights: P.weights });
  for (const set of sets) {
    if (clock() - t0 > P.timeLimitMs) { timedOut = true; break; }
    const m = cloneModel(model);
    const freedoms = {};
    for (const c of set) { if (c.apply) c.apply(m); Object.assign(freedoms, c.freedoms || {}); }
    const fixed = set.reduce((a, c) => a + c.fixedUnits, 0);
    const solved = solvePlan(m, null, { freedoms, timeLimitMs: P.perSetTimeLimitMs, weights: P.weights, extraCostUnits: fixed, clock: opts.clock });
    const e = solved.evaluation;
    // Loans: the lending municipality must still meet its own service level without ALL the crews this set takes from it.
    const donorChecks = [];
    for (const [did, loans] of Object.entries(groupBy(set.filter((c) => c.code === "LOAN"), (c) => c.donorMunicipalityId))) {
      const d = donors.find((x) => x.municipalityId === did);
      const taken = new Set(loans.map((c) => c.details.driverId));
      const without = { ...d.state, profiles: (d.state.profiles || []).filter((p) => !taken.has(p.uid)) };
      const after = evaluateFeasibility(without, { now, settings: opts.settings, policy: FP, clock: opts.clock });
      const worse = after.unservedBins.length > d.base.unservedBins.length || (after.lateBins || []).length > (d.base.lateBins || []).length;
      const ok = after.feasible || (!d.base.feasible && !worse);
      donorChecks.push({ municipalityId: did, name: d.name || did, crewsLent: loans.length, ok, before: { status: d.base.feasibilityStatus, unserved: d.base.unservedBins.length }, after: { status: after.feasibilityStatus, unserved: after.unservedBins.length, late: (after.lateBins || []).length },
        reason: ok ? null : `تفقد ${d.name || did} قدرتها على الوفاء بالتزاماتها خلال فترة الإعارة (${after.unservedBins.length} حاوية بلا خدمة${(after.lateBins || []).length ? `، ${after.lateBins.length} متأخرة` : ""})` });
    }
    const donorOk = donorChecks.every((x) => x.ok);
    const valid = e.valid && donorOk;
    const diff = planDiff(model, base.plan, m, solved.plan, baseEval, e);
    evaluated.push({
      id: set.map((c) => c.id).join("+"), interventions: set.map(({ apply, freedoms: _f, ...rest }) => rest), // eslint-disable-line no-unused-vars
      size: set.length, valid, slaMet: e.slaMet, success: valid && e.slaMet,
      feasibilityStatus: valid && e.slaMet ? FEASIBILITY_STATUS.FEASIBLE : !donorOk ? "REJECTED_DONOR" : e.hardViolations.length ? "HARD_VIOLATION" : e.unverifiable ? FEASIBILITY_STATUS.INSUFFICIENT_DATA : "SERVICE_LEVEL_NOT_MET",
      unserved: e.unserved, late: e.late, lateMin: e.lateMin, costUnits: e.costUnits, changeUnits: e.changeUnits, fixedUnits: fixed,
      costBreakdown: [{ code: "drive", units: Math.round(e.driveMin * P.weights.driveMinute), minutes: e.driveMin }, ...(e.overtimeMin ? [{ code: "overtime", units: e.overtimeMin * P.weights.overtimeMinute, minutes: e.overtimeMin }] : []),
        ...(e.change.movedBins ? [{ code: "movedBins", units: e.change.movedBins * P.weights.movedBin, count: e.change.movedBins }] : []), ...(e.change.resequencedRoutes ? [{ code: "resequencedRoutes", units: e.change.resequencedRoutes * P.weights.resequencedRoute, count: e.change.resequencedRoutes }] : []),
        ...set.flatMap((c) => c.components)],
      money: monetary(e, set.flatMap((c) => c.components), rates),
      driveMin: e.driveMin, km: e.km, overtimeMin: e.overtimeMin, completionMin: e.completionMin,
      hardViolations: [...new Set(e.hardViolations.map((v) => v.code))], missing: [...new Set(e.missing.map((x) => x.code))], donorChecks,
      // For an alternative that leaves bins unserved: which HARD constraints prevented serving them (never traded for cost).
      blockedBy: e.unserved.length ? [...new Set(explainUnserved(m, solved.plan, e.unserved).map((v) => v.code))] : [],
      authority: set.reduce((a, c) => (ROLE_RANK[c.authority] > ROLE_RANK[a] ? c.authority : a), "employee"),
      requiresExternalAction: set.some((c) => c.requiresExternalAction), simulated: set.some((c) => c.simulated),
      diff, plan: solved.plan, times: e.times, solver: { iterations: solved.solver.iterations, elapsedMs: solved.solver.elapsedMs, timedOut: solved.solver.timedOut },
      key: [valid ? 0 : 1, e.unverifiable ? 1 : 0, e.unserved.length, e.late.length, Math.round(e.lateMin), e.costUnits, e.changeUnits, set.length],
    });
  }
  evaluated.sort((a, b) => compareKeys(a.key, b.key));
  const winners = evaluated.filter((x) => x.success);
  const recommended = winners[0] || null;
  const bestPartial = !recommended ? evaluated.find((x) => x.valid) || null : null;
  // Why each other alternative was not chosen — from the engine's own figures.
  for (const x of evaluated) {
    if (x === recommended) { x.verdict = "CHOSEN"; continue; }
    if (x.donorChecks.some((d) => !d.ok)) { x.verdict = "REJECTED_DONOR"; x.rejectReason = x.donorChecks.find((d) => !d.ok).reason; continue; }
    if (x.hardViolations.length) { x.verdict = "HARD_VIOLATION"; x.rejectReason = `يخالف قيدًا صارمًا: ${x.hardViolations.map(constraintText).join("، ")}`; continue; }
    if (x.missing.length) { x.verdict = "INSUFFICIENT_DATA"; x.rejectReason = `بيانات ناقصة: ${x.missing.map(constraintText).join("، ")}`; continue; }
    if (!x.slaMet) { x.verdict = "SERVICE_LEVEL_NOT_MET"; x.rejectReason = `لا يحقق مستوى الخدمة: ${x.unserved.length} حاوية بلا خدمة${x.late.length ? `، ${x.late.length} متأخرة` : ""}${x.blockedBy.length ? ` — يمنعه قيد صارم: ${x.blockedBy.map(constraintText).join("، ")}` : ""}`; continue; }
    x.verdict = "COSTLIER"; x.rejectReason = `صالح لكنه أعلى تكلفة (+${x.costUnits - recommended.costUnits} دقيقة مكافئة)${x.changeUnits > recommended.changeUnits ? " وتغيير أكبر للخطة" : ""}`;
  }
  const elapsedMs = clock() - t0;
  const search = {
    status: timedOut ? "TIME_LIMIT" : "COMPLETE_IN_SCOPE",
    optimality: recommended ? (timedOut ? "BEST_FOUND_BEFORE_TIME_LIMIT" : "BEST_IN_SEARCH_SCOPE") : "NONE",
    note: "أفضل بديل صالح ضمن نطاق البحث المحدد (أنواع التدخلات المسموحة × التركيبات حتى الحد الأقصى) — لا يُدّعى أنه الأمثل مطلقًا، وترتيب التوقفات داخل كل خطة بحث محلي",
    candidates: candidates.length, setsTotal: sets.length, setsEvaluated: evaluated.length, maxCombination: k, timeLimitMs: P.timeLimitMs, perSetTimeLimitMs: P.perSetTimeLimitMs, elapsedMs,
    allowedTypes: Object.entries(P.allowed).filter(([, v]) => v).map(([c]) => c),
    algorithm: "enumeration of compatible intervention sets (≤ k) × priority insertion + relocate/2-opt local search; lexicographic objective",
  };
  const result = {
    ...meta, status: recommended ? "RECOMMENDATION" : bestPartial ? "PARTIAL_ONLY" : "NO_VALID_ADJUSTMENT", needed: true,
    base: stripBase(base), deficit: deficitSummary(base, model),
    alternatives: evaluated.map(stripAlt), rejectedCandidates: rejected, recommended: recommended ? stripAlt(recommended) : null, bestPartial: bestPartial ? stripAlt(bestPartial) : null,
    ifNotAdopted: ifNotAdopted(base, model), search, costModel: { unit: "دقيقة مكافئة", weights: P.weights, money: rates ? { source: rates.source, kind: rates.simulation ? "simulation" : "documented" } : null },
    dataQuality: base.confidenceOrQualityFlags, simulatedEnvironment: simulatedEnv,
  };
  result.explanation = buildAdjustmentRecord(result);
  return result;
}

const safe = (fn) => { try { return fn(); } catch { return null; } };
const groupBy = (arr, fn) => arr.reduce((o, x) => { (o[fn(x)] ||= []).push(x); return o; }, {});

function stripBase(b) {
  // eslint-disable-next-line no-unused-vars
  const { model, ...rest } = b;
  return rest;
}
function stripAlt(x) {
  // eslint-disable-next-line no-unused-vars
  const { key, ...rest } = x;
  return rest;
}

function deficitSummary(base, model) {
  const crit = model.due.filter((d) => d.critical && !d.committed).length;
  return {
    status: base.feasibilityStatus, statusText: base.feasibilityStatus, cause: base.cause, causeText: DEFICIT_CAUSE_TEXT[base.cause] || base.cause,
    blockingConstraints: base.blockingConstraintCodes.map((c) => ({ code: c, hard: !!CONSTRAINTS[c]?.hard, text: constraintText(c) })),
    proofs: base.proofs, missing: [...new Set(base.missingData.map((m) => m.code))].map((c) => ({ code: c, text: MISSING_DATA_TEXT[c] || c })),
    unserved: base.unservedBins.length, late: (base.lateBins || []).length, criticalOpen: crit, due: model.due.length,
  };
}

function ifNotAdopted(base, model) {
  const soon = base.unservedBins.map((id) => model.dueById.get(id)).filter((d) => d && d.hoursToFull != null && d.hoursToFull <= 3);
  return {
    unservedBins: base.unservedBins.length, lateBins: (base.lateBins || []).length, lateMin: base.evaluation?.lateMin ?? null,
    criticalUnserved: base.unservedBins.filter((id) => model.dueById.get(id)?.critical).length,
    overflowRiskBins: soon.length, overflowRiskText: soon.length ? `${soon.length} حاوية متوقع امتلاؤها خلال 3 ساعات تبقى بلا خدمة` : null,
  };
}

// ── decision record (structured; the Arabic summary is a fixed template over these fields) ──

export const ADJUSTMENT_RECORD_VERSION = 1;

export function buildAdjustmentRecord(r) {
  const chosen = r.recommended;
  const studied = r.alternatives.length;
  const why = [];
  if (chosen) {
    why.push("LOWEST_COST_VALID_IN_SCOPE");
    if (!chosen.interventions.some((i) => ["ADD_RESOURCE", "LOAN"].includes(i.code))) why.push("NO_EXTRA_OR_BORROWED_RESOURCE");
    if (!chosen.hardViolations.length) why.push("RESPECTS_HARD_CONSTRAINTS");
    if (chosen.slaMet) why.push("MEETS_SERVICE_LEVEL");
    if (chosen.interventions.some((i) => i.code === "LOAN")) why.push("DONOR_VERIFIED");
  }
  return {
    v: ADJUSTMENT_RECORD_VERSION, decisionType: "OPERATIONAL_ADJUSTMENT", decidedAt: r.analyzedAt, municipalityId: r.municipalityId,
    engineVersion: r.engineVersion, feasibilityVersion: r.feasibilityVersion, policyVersion: r.policyVersion,
    originalPlan: { status: r.base.feasibilityStatus, cause: r.deficit.cause, blocking: r.deficit.blockingConstraints.map((c) => c.code), unserved: r.deficit.unserved, late: r.deficit.late, proofs: r.deficit.proofs.map((p) => p.code) },
    alternatives: { studied, scope: r.search, excluded: r.alternatives.filter((x) => x.verdict !== "CHOSEN").slice(0, 25).map((x) => ({ id: x.id, codes: x.interventions.map((i) => i.code), verdict: x.verdict, reason: x.rejectReason, costUnits: x.costUnits, unserved: x.unserved.length, late: x.late.length })),
      rejectedBeforeEvaluation: r.rejectedCandidates.slice(0, 25) },
    chosen: chosen ? { id: chosen.id, codes: chosen.interventions.map((i) => i.code), costUnits: chosen.costUnits, money: chosen.money, completionMin: chosen.completionMin, affectedRoutes: chosen.diff.routeChanges.map((x) => x.routeId), newRoutes: chosen.diff.newRoutes.length, authority: chosen.authority, why } : null,
    ifNotAdopted: r.ifNotAdopted, dataQuality: (r.dataQuality || []).map((q) => q.code), simulatedEnvironment: r.simulatedEnvironment,
  };
}

/** One paragraph, assembled from the record's codes and figures (fixed templates; never a language model). */
export function adjustmentSummary(r) {
  if (!r || r.status === "NO_DEFICIT") return "الخطة التشغيلية الحالية تحقق مستوى الخدمة — لا حاجة لتعديل.";
  if (r.status === "ERROR") return "تعذر تحليل البدائل بسبب خطأ في التقييم.";
  const head = `تعذر تنفيذ الخطة الحالية بسبب ${r.deficit.causeText}.`;
  const scope = r.search.status === "TIME_LIMIT" ? ` (انتهت مهلة البحث بعد ${r.search.setsEvaluated} من ${r.search.setsTotal} تركيبة)` : "";
  const studied = ` قارن النظام ${r.search.setsEvaluated} ${r.search.setsEvaluated === 1 ? "تعديلًا تشغيليًا" : "تعديلات تشغيلية"}${scope}.`;
  if (!r.recommended) {
    return `${head}${studied} لم يحقق أي تعديل ضمن النطاق المسموح مستوى الخدمة كاملًا${r.bestPartial ? `؛ أفضل بديل صالح جزئيًا يترك ${r.bestPartial.unserved.length} حاوية بلا خدمة` : ""}.`;
  }
  const c = r.recommended;
  const names = c.interventions.map((i) => `«${i.title}»`).join(" مع ");
  const noExtra = !c.interventions.some((i) => ["ADD_RESOURCE", "LOAN"].includes(i.code)) ? " لا تتطلب التوصية إضافة مركبة أو إعارة،" : c.interventions.some((i) => i.code === "LOAN") ? " تحققنا من قدرة البلدية المعيرة على الوفاء بالتزاماتها خلال الإعارة،" : "";
  return `${head}${studied} كان ${names} أقل التعديلات تكلفة بين البدائل الصالحة التي جرى تقييمها.${noExtra} ولا تتجاوز المناوبات أو السعات المسجلة في النظام.`;
}

export const INTERVENTION_TEXT = Object.fromEntries(Object.entries(INTERVENTION_TYPES).map(([k, v]) => [k, v.title]));
export const VERDICT_TEXT = { CHOSEN: "التوصية", COSTLIER: "صالح وأعلى تكلفة", SERVICE_LEVEL_NOT_MET: "لا يحقق مستوى الخدمة", HARD_VIOLATION: "يخالف قيدًا صارمًا", INSUFFICIENT_DATA: "بيانات ناقصة", REJECTED_DONOR: "يضر البلدية المعيرة" };
export const COST_COMPONENT_TEXT = { drive: "زمن القيادة", overtime: "ساعات إضافية", movedBins: "حاويات نُقلت من جولاتها", resequencedRoutes: "جولات أُعيد ترتيبها", retimedRoute: "تعديل توقيت جولة", reservedRoute: "حجز جولة لاحقة", vehicleReassigned: "إعادة ربط مركبة", loanFixed: "التكلفة الإدارية للإعارة", loanTravel: "انتقال الطاقم المعار ذهابًا وإيابًا", extraCrew: "طاقم إضافي" };
