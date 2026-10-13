/**
 * decisionExplain.js — "لماذا اتخذ النظام هذا القرار؟"
 * ─────────────────────────────────────────────────────────────────────
 * Structured, auditable decision records. Every field is copied from the data
 * and constraints the dispatch engine actually used — codes, counts, minutes,
 * litres. The Arabic summary is assembled from fixed templates keyed by those
 * codes; no language model is involved and nothing is inferred after the fact.
 * A decision stored before this format existed has no record, and the UI says
 * "تفاصيل القرار غير متاحة" instead of reconstructing one.
 * ─────────────────────────────────────────────────────────────────────
 */
import { haversineDistanceKm } from "./decisionEngine.js";
import { REASON_TEXT } from "./assignmentEngine.js";
import { computeOperationalImpact } from "./impact.js";
import { compareDistance, fuelOf, co2Of, DISTANCE_BASIS, SAVING_KIND } from "./savings.js";

export const EXPLANATION_VERSION = 1;

export const DECISION_TYPES = {
  AUTO_ASSIGNMENT: "إسناد جولة جديدة",
  NEXT_ROUTE_RESERVATION: "حجز جولة تالية",
  ROUTE_INSERTION: "إضافة إلى جولة قائمة",
  REASSIGNMENT: "إعادة إسناد",
  RELEASE: "سحب الإسناد",
  ESCALATION: "رفع لموظف العمليات",
};

export const TRIGGER_TEXT = {
  CRITICAL_FILL: "حاويات تجاوزت حد الامتلاء الحرج",
  HIGH_PRIORITY_BATCH: "حاويات مرتفعة الأولوية بلغت الحد الأدنى للجولة",
  PREDICTED_FULL: "حاويات متوقع امتلاؤها قريبًا",
  DRIVER_BLOCKED: "سائق جولة معتمدة لم يعد متاحًا",
};

export const ALTERNATIVE_TEXT = {
  INSERT_EXISTING_ROUTE: "إضافة الحاويات إلى جولة قائمة",
  RESERVE_NEXT_ROUTE: "حجز جولة تالية لسائق ينهي جولته قريبًا",
  NEW_ROUTE_AVAILABLE_DRIVER: "جولة جديدة لسائق متاح",
};

export const CONSTRAINT_TEXT = {
  MAX_APPROACH_MIN: "الحد الأقصى لزمن الوصول",
  CRITICAL_TARGET_MIN: "الزمن المستهدف لجمع الحاويات الحرجة",
  MAX_STOPS: "الحد الأقصى لعدد التوقفات",
  VEHICLE_CAPACITY_L: "سعة المركبة المتبقية",
  SHIFT_MINUTES_LEFT: "الوقت المتبقي من المناوبة",
  ROUTE_KM_TARGET: "الحد المستهدف لمسافة الجولة",
  INSERT_MAX_ADDED_MIN: "الحد الأقصى للزمن المضاف عند الإدراج",
};

export const INSERT_REJECT_TEXT = {
  ROUTE_STOP_LIMIT: "الجولة بلغت الحد الأقصى للتوقفات",
  ROUTE_CAPACITY: "سعة مركبة الجولة لا تكفي",
  ROUTE_TOO_FAR: "الجولة بعيدة عن الحاوية",
  DETOUR_TOO_LONG: "الانحراف يتجاوز الزمن المسموح",
  INSERT_LATER_THAN_TARGET: "الوصول عبر الجولة يتجاوز الزمن المستهدف",
  NO_COORDINATES: "لا إحداثيات لحساب الإدراج",
  NO_ACTIVE_ROUTES: "لا جولات نشطة في البلدية",
};

const round1 = (v) => Math.round(v * 10) / 10;

/** Straight-line path length start → stops in the given order (no return leg). */
export function pathKm(start, stops) {
  let km = 0, prev = start?.lat != null ? start : null;
  for (const s of stops) {
    if (s.lat == null || s.lng == null) continue;
    if (prev) km += haversineDistanceKm(prev.lat, prev.lng, s.lat, s.lng) ?? 0;
    prev = s;
  }
  return round1(km);
}

/**
 * Reference route for the same bins and the same start: the order a dispatcher
 * would follow without optimisation — most urgent first (priority score, then fill).
 * Used only as the comparison baseline for "distance saved".
 */
export function referenceOrder(stops) {
  return [...stops].sort((a, b) => (Number(b.priorityScore) || 0) - (Number(a.priorityScore) || 0) || (Number(b.fillLevelPercent) || 0) - (Number(a.fillLevelPercent) || 0) || String(a.binId).localeCompare(String(b.binId)));
}

/** Expected (not realised) distance comparison for a planned route. Factors may be null → fuel/CO2 null. */
export function expectedRouteImpact(start, orderedStops, factors = {}) {
  if (!start || orderedStops.filter((s) => s.lat != null).length < 2) return null;
  const routeKm = pathKm(start, orderedStops);
  const referenceKm = pathKm(start, referenceOrder(orderedStops));
  // Signed: a route longer than its reference is reported as an increase (outcome INCREASE), never as 0 saved.
  const cmp = compareDistance(referenceKm, routeKm, { basis: DISTANCE_BASIS.EXPECTED_HAVERSINE, kind: SAVING_KIND.EXPECTED });
  const kmSaved = cmp.deltaKm;
  const fuelL = fuelOf(kmSaved, factors.fuelLitersPerKm);
  const co2Kg = co2Of(fuelL, factors.co2KgPerLiter);
  return { basis: "expected", metric: "haversine", distanceBasis: cmp.basis, routeKm, referenceKm, kmSaved, outcome: cmp.outcome, fuelL, co2Kg };
}

const fillSource = (bins) => {
  const sim = bins.filter((b) => b.simulated || b.demo).length;
  return sim === 0 ? "sensor" : sim === bins.length ? "simulated" : "mixed";
};

export function triggerOf(bins, urgentFillPct) {
  const crit = bins.filter((b) => Number(b.fillPct) >= urgentFillPct && Number(b.fillPct) <= 100).length;
  const predicted = bins.filter((b) => b.predicted).length;
  return { code: crit > 0 ? "CRITICAL_FILL" : predicted > 0 && predicted === bins.length ? "PREDICTED_FULL" : "HIGH_PRIORITY_BATCH", criticalCount: crit, predictedCount: predicted };
}

/** Bin facts recorded in the decision (what the engine saw). */
export function binFacts(bin, priority) {
  return {
    binId: bin.id, name: bin.name || bin.id, fillPct: bin.lastFillLevelPercent ?? null, tier: priority?.tier || null, score: priority?.score ?? null,
    reasons: (priority?.reasons || []).slice(0, 3), predicted: !!(priority?.prediction?.predictionAvailable && priority.prediction.hoursToFull != null && priority.prediction.hoursToFull <= 6),
    lastReadingAt: bin.lastReadingAt || null, source: bin.simulated || bin.demo ? "simulated" : "sensor", simulated: !!(bin.simulated || bin.demo),
  };
}

/**
 * Explanation for an automatic assignment (new route or next-route reservation).
 * @param {object} p  everything the engine used — see planDispatch.
 */
export function buildAssignmentExplanation(p) {
  const { now, municipalityId, neighborhoodId, neighborhoodName, binsFacts, rec, evaluation, alternatives = [], constraints = [], routingStatus, matrixSource, impact, settings } = p;
  const trig = triggerOf(binsFacts, settings.urgentFillPct);
  const at = (min) => (min == null ? null : new Date(now + min * 60000).toISOString());
  return {
    v: EXPLANATION_VERSION,
    decisionType: rec.mode === "next_route" ? "NEXT_ROUTE_RESERVATION" : "AUTO_ASSIGNMENT",
    decidedAt: new Date(now).toISOString(), municipalityId, neighborhoodId, neighborhoodName,
    trigger: { code: trig.code, criticalCount: trig.criticalCount, predictedCount: trig.predictedCount, binsCount: binsFacts.length, bins: binsFacts.slice(0, 20) },
    selection: { driverId: rec.driverId, driverName: rec.driverName, vehicleId: rec.vehicleId, vehicleNumber: rec.vehicleNumber, reasonCodes: rec.reasonCodes, mode: rec.mode,
      startAfterMin: rec.startAfterMin || 0, afterRouteId: rec.afterRouteId || null, driverState: rec.state || null, score: rec.score, confidence: rec.confidence },
    candidates: { evaluated: evaluation.evaluated, eligible: evaluation.eligible, excluded: evaluation.excluded.slice(0, 12) },
    vehicle: { capacityL: rec.capacityL, queuedL: rec.queuedL, remainingL: rec.remainingL, routeWasteL: rec.routeWasteL },
    timing: { approachMin: rec.approachMin, etaMin: rec.etaMin, routeDriveMin: rec.routeDriveMin, serviceMin: rec.serviceMin, completionMin: rec.totalMin,
      expectedFirstArrivalAt: at(rec.etaMin), expectedCompletionAt: at(rec.totalMin), shiftMinutesLeft: rec.shiftMinutesLeft ?? null, shiftLabel: rec.shiftLabel || null },
    alternatives, constraints, impact: impact || null,
    dataSources: { fill: fillSource(binsFacts), readingsWindowHours: 24, approach: rec.travelSource === "osrm" ? "osrm" : routingStatus === "failed" ? "estimate_routing_failed" : "estimate",
      routeOrder: matrixSource || "haversine", origin: rec.originSource || null },
  };
}

/** Explanation for adding a bin to an existing route. */
export function buildInsertionExplanation({ now, municipalityId, route, bin, priority, ins, cap, load, wasteL, consideredRoutes = [], settings, etaMin }) {
  return {
    v: EXPLANATION_VERSION, decisionType: "ROUTE_INSERTION", decidedAt: new Date(now).toISOString(), municipalityId, neighborhoodId: bin.neighborhoodId || null,
    trigger: { code: triggerOf([{ fillPct: bin.lastFillLevelPercent }], settings.urgentFillPct).code, binsCount: 1, bins: [binFacts(bin, priority)] },
    selection: { driverId: route.driverId, driverName: route.driverName || "", vehicleId: route.vehicleId || null, routeId: route.id, routeName: route.routeName, reasonCodes: ["CHEAPEST_INSERTION", "WITHIN_DETOUR_LIMIT", ...(cap != null ? ["SUFFICIENT_CAPACITY"] : ["CAPACITY_UNKNOWN"])] },
    vehicle: { capacityL: cap, queuedL: load, remainingL: cap != null ? cap - load : null, routeWasteL: wasteL },
    timing: { addedMin: ins.addedMin, detourKm: ins.detourKm, etaMin: etaMin ?? null, expectedFirstArrivalAt: etaMin != null ? new Date(now + etaMin * 60000).toISOString() : null },
    alternatives: consideredRoutes.slice(0, 8),
    constraints: [
      { code: "INSERT_MAX_ADDED_MIN", value: ins.addedMin, limit: settings.insertMaxAddedMin, met: ins.addedMin <= settings.insertMaxAddedMin },
      ...(cap != null ? [{ code: "VEHICLE_CAPACITY_L", value: load + wasteL, limit: cap, met: load + wasteL <= cap }] : []),
    ],
    dataSources: { fill: bin.simulated || bin.demo ? "simulated" : "sensor", readingsWindowHours: 24, approach: "estimate", routeOrder: "haversine" },
  };
}

/** Explanation for an escalation: which drivers were studied and why none qualified. */
export function buildEscalationExplanation({ now, municipalityId, neighborhoodId, neighborhoodName, kind, binsFacts = [], evaluation = null, constraints = [], settings }) {
  const trig = triggerOf(binsFacts, settings.urgentFillPct);
  return {
    v: EXPLANATION_VERSION, decisionType: "ESCALATION", escalationKind: kind, decidedAt: new Date(now).toISOString(), municipalityId, neighborhoodId, neighborhoodName: neighborhoodName || null,
    trigger: { code: trig.code, criticalCount: trig.criticalCount, binsCount: binsFacts.length, bins: binsFacts.slice(0, 20) },
    candidates: evaluation ? { evaluated: evaluation.evaluated, eligible: evaluation.eligible, excluded: evaluation.excluded.slice(0, 12) } : null,
    constraints, dataSources: { fill: fillSource(binsFacts), readingsWindowHours: 24 },
  };
}

/** Minutes in Arabic with number agreement (1 دقيقة · 2 دقيقتان · 3–10 دقائق · 11+ دقيقة). */
export const minutesText = (m) => {
  if (m == null) return "غير متاح";
  if (m >= 60) return `${Math.floor(m / 60)} س${m % 60 ? ` و${m % 60} د` : ""}`;
  return m === 1 ? "دقيقة واحدة" : m === 2 ? "دقيقتين" : m >= 3 && m <= 10 ? `${m} دقائق` : `${m} دقيقة`;
};

/**
 * One-paragraph summary from codes only (fixed templates).
 * Returns null when the decision has no structured record.
 */
export function explanationSummary(exp) {
  if (!exp || exp.v !== EXPLANATION_VERSION) return null;
  if (["AUTO_ASSIGNMENT", "NEXT_ROUTE_RESERVATION", "REASSIGNMENT"].includes(exp.decisionType)) {
    const c = exp.selection.reasonCodes || [];
    const why = [];
    if (c.includes("NEXT_ROUTE_AFTER_CURRENT")) why.push(`سيبدأها فور إنهاء جولته الحالية خلال نحو ${minutesText(exp.selection.startAfterMin)}`);
    if (c.includes("LOWEST_ELIGIBLE_ROAD_ETA") || c.includes("LOWEST_ELIGIBLE_ESTIMATED_ETA")) why.push("الأقرب زمنيًا بين السائقين المؤهلين");
    else if (c.includes("HIGHEST_SCORE_NOT_EARLIEST")) why.push("الأعلى تقييمًا بين المؤهلين (من يصل أبكر لم يستوفِ كل المعايير)");
    if (c.includes("SUFFICIENT_CAPACITY")) why.push("ومركبته تستوعب الحمولة المطلوبة");
    if (c.includes("SHIFT_AVAILABLE")) why.push("ومناوبته تسمح بإكمال الجولة");
    const timing = `الجمع المتوقع خلال ${minutesText(exp.timing.completionMin)} (أول حاوية خلال ${minutesText(exp.timing.etaMin)}).`;
    if (exp.decisionType === "REASSIGNMENT") {
      return `أُعيد إسناد الجولة إلى ${exp.selection.driverName} لأن ${exp.previousDriver?.blocker || "السائق السابق لم يعد متاحًا"}؛ واختير لأنه ${why.join("، ")}. ${timing}`;
    }
    const verb = exp.decisionType === "NEXT_ROUTE_RESERVATION" ? "حُجزت الجولة التالية لـ" : "أُسندت الجولة إلى ";
    return `${verb}${exp.selection.driverName} لأنه ${why.join("، ")}. ${timing}`;
  }
  if (exp.decisionType === "ROUTE_INSERTION") {
    return `أُضيفت ${exp.trigger.bins[0]?.name || "الحاوية"} إلى ${exp.selection.routeName} لدى ${exp.selection.driverName || "السائق"} لأن الإدراج يضيف ${minutesText(exp.timing.addedMin)} فقط ضمن الحد المسموح، بدل إنشاء جولة جديدة.`;
  }
  if (exp.decisionType === "ESCALATION") {
    if (exp.escalationKind === "target_gap") return "أُسندت الجولة بأفضل خيار متاح، لكن الجمع المتوقع يتجاوز الزمن المستهدف، فرُفعت توصية لمعالجة فجوة الموارد.";
    const ev = exp.candidates;
    return ev ? `دُرس ${ev.evaluated} سائق ولم يستوفِ أيٌّ منهم كل القيود، فرُفعت الحالة لموظف العمليات.` : "رُفعت الحالة لموظف العمليات لأنها تتطلب قرارًا بشريًا.";
  }
  return null;
}

export const reasonText = (code) => REASON_TEXT[code] || INSERT_REJECT_TEXT[code] || code;

/** Realised vs expected performance and impact (impact.computeOperationalImpact with the shared reference route). */
export function operationalImpact(args) {
  return computeOperationalImpact({ ...args, referenceOrder, pathKm });
}
