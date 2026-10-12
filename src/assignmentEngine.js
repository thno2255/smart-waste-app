/**
 * assignmentEngine.js — Phase 2: who should run this route?
 * ─────────────────────────────────────────────────────────────────────
 * Pure ranking of driver candidates for ONE route. Builds on
 * fleetEngine.eligibleDriversFor (hard filters: account, shift, availability,
 * coverage, vehicle, active route) and adds the soft, explainable factors:
 *
 *   travel time   — REAL road duration from the driver's origin to the first
 *                   stop when the caller supplies it (OSRM); otherwise a
 *                   Haversine estimate, and the result SAYS which one it used.
 *   origin        — the driver's last location only if it is fresh; otherwise
 *                   the vehicle's depot (or the city default), flagged as such.
 *   capacity      — vehicle capacity minus the waste already queued on the
 *                   driver's other open routes vs. this route's estimate.
 *   workload      — number of routes already queued for the driver.
 *
 * Nothing here is a fixed "magic" number except the documented weights below,
 * which are relative (score out of 100) and never shown as measurements. All
 * distances/durations in the output come from inputs (OSRM or geometry).
 * ─────────────────────────────────────────────────────────────────────
 */
import { eligibleDriversFor, locationFreshness, ACTIVE_ROUTE_STATUSES } from "./fleetEngine.js";
import { driverOperationalState, DEFAULT_TZ_OFFSET_MIN } from "./driverState.js";
import { haversineDistanceKm, estimateTravelMinutes } from "./decisionEngine.js";
import { ASSUMPTIONS } from "./impact.js";

/** Relative weights (sum 100). Documented so a reviewer can challenge them. */
export const WEIGHTS = { travel: 45, capacity: 25, workload: 20, locationConfidence: 10 };

/** Where a driver would start from, and how much we trust it. */
export function driverOrigin(profile, vehicle, { now = Date.now(), fallback = null } = {}) {
  const fresh = locationFreshness(profile?.lastLocation, { now });
  if (fresh.state === "live" && profile.lastLocation?.lat != null) {
    return { lat: profile.lastLocation.lat, lng: profile.lastLocation.lng, source: "live", label: "موقع مباشر", ageMin: fresh.ageMin };
  }
  if (vehicle?.depotLat != null && vehicle?.depotLng != null) {
    return { lat: vehicle.depotLat, lng: vehicle.depotLng, source: fresh.state === "stale" ? "stale_depot" : "depot", label: fresh.state === "stale" ? `آخر موقع قديم (قبل ${fresh.ageMin} د) — استُخدم مستودع المركبة` : "مستودع المركبة (لا موقع مباشر)", ageMin: fresh.ageMin };
  }
  if (fallback) return { ...fallback, source: "default", label: "موقع افتراضي للمدينة (لا موقع ولا مستودع)", ageMin: fresh.ageMin };
  return null;
}

/** Waste (liters) already queued on a driver's open routes other than `routeId`. */
export function queuedWasteLiters(driverId, routes = [], routeId = null) {
  return routes
    .filter((r) => r.id !== routeId && r.driverId === driverId && ACTIVE_ROUTE_STATUSES.includes(r.status))
    .reduce((a, r) => a + (Number(r.estimatedWasteLiters) || 0), 0);
}

/**
 * @param {object} route  suggested route (orderedStops with lat/lng, estimatedDistanceKm, estimatedWasteLiters, binIds)
 * @param {object} ctx
 * @param {Array} ctx.profiles  driver profiles
 * @param {Array} ctx.vehicles
 * @param {Array} ctx.routes    all routes (for workload + queued waste)
 * @param {string} ctx.neighborhoodName  route's neighborhood (coverage check)
 * @param {Object<string,{distanceKm:number,durationMin:number}>} [ctx.travelByDriver]  REAL road legs origin→first stop (OSRM), keyed by driver uid
 *        (and by `${uid}@next` for the leg from the end of a driver's current route)
 * @param {{distanceKm:number,durationMin:number}|null} [ctx.routeRoad]  REAL road figures for the route itself (OSRM), if known
 * @param {{lat:number,lng:number}} [ctx.defaultOrigin]
 * @param {number} [ctx.now]
 * @param {{enabled:boolean, withinMin:number}} [ctx.reservation]  allow a driver on an IN-PROGRESS route who finishes within
 *        `withinMin` to take this as their next route (NEXT_ROUTE_RESERVED). Off by default.
 * @param {number} [ctx.tzOffsetMin]  shift times are local wall-clock
 * @returns {{candidates: Array, recommended: object|null, warnings: string[], evaluation: object}}
 */
export function rankDriverCandidates(route, ctx = {}) {
  const { profiles = [], vehicles = [], routes = [], incidents = [], neighborhoodName = "", travelByDriver = {}, routeRoad = null, defaultOrigin = null, now = Date.now(),
    reservation = { enabled: false, withinMin: 0 }, tzOffsetMin = DEFAULT_TZ_OFFSET_MIN } = ctx;
  const firstStop = (route?.orderedStops || []).find((s) => s.lat != null && s.lng != null) || null;
  const stopsCount = route?.orderedStops?.length || route?.binIds?.length || 0;
  const routeKm = routeRoad?.distanceKm ?? (Number(route?.estimatedDistanceKm) || 0);
  const routeDriveMin = routeRoad?.durationMin ?? estimateTravelMinutes(routeKm);
  const serviceMin = stopsCount * ASSUMPTIONS.minutesPerStop;
  const wasteL = Number(route?.estimatedWasteLiters) || 0;
  const otherRoutes = routes.filter((r) => r.id !== route?.id);

  const verdicts = eligibleDriversFor(neighborhoodName, { profiles, vehicles, routes: otherRoutes, at: now });
  const raw = verdicts.map((v) => {
    const p = v.profile;
    const st = driverOperationalState(p, { vehicle: v.vehicle, routes: otherRoutes, incidents, now, tzOffsetMin });
    const codes = [...v.codes];
    let mode = "now", startAfterMin = 0, afterRouteId = null;
    // A driver whose ONLY blocker is a route in progress may be reserved for the next route if they finish soon.
    if (codes.length === 1 && codes[0] === "HAS_ACTIVE_ROUTE") {
      const current = st.currentRoute;
      const onlyCurrent = current && st.activeRoutes.length === 1;
      if (!reservation.enabled) codes.splice(0, 1, "BUSY_ON_ROUTE");
      else if (!current) codes.splice(0, 1, "BUSY_ROUTE_NOT_STARTED");
      else if (!onlyCurrent) codes.splice(0, 1, "NEXT_ROUTE_ALREADY_RESERVED");
      else if (st.finishInMin == null || st.finishInMin > reservation.withinMin) codes.splice(0, 1, "FINISHES_TOO_LATE");
      else { codes.length = 0; mode = "next_route"; startAfterMin = st.finishInMin; afterRouteId = current.id; }
    }
    const origin = mode === "next_route" && st.endPoint
      ? { lat: st.endPoint.lat, lng: st.endPoint.lng, source: "route_end", label: "نهاية جولته الحالية" }
      : driverOrigin(p, v.vehicle, { now, fallback: defaultOrigin });
    const road = (mode === "next_route" ? travelByDriver[`${p.uid}@next`] : travelByDriver[p.uid]) || null;
    let approachKm = null, approachMin = null, travelSource = "none";
    if (road) { approachKm = road.distanceKm; approachMin = road.durationMin; travelSource = "osrm"; }
    else if (origin && firstStop) { approachKm = Math.round((haversineDistanceKm(origin.lat, origin.lng, firstStop.lat, firstStop.lng) ?? 0) * 10) / 10; approachMin = estimateTravelMinutes(approachKm); travelSource = "haversine"; }

    const capacity = Number(v.vehicle?.capacityLiters) || 0;
    const queuedL = queuedWasteLiters(p.uid, otherRoutes, route?.id);
    const remainingL = capacity ? Math.max(0, capacity - queuedL) : null;
    const capacityOk = remainingL == null ? null : remainingL >= wasteL;
    const queuedRoutes = otherRoutes.filter((r) => r.driverId === p.uid && ACTIVE_ROUTE_STATUSES.includes(r.status)).length;
    const etaMin = approachMin != null ? startAfterMin + approachMin : null;
    const completionMin = approachMin != null ? Math.round(startAfterMin + approachMin + routeDriveMin + serviceMin) : null;
    // Hard shift constraint: never assign work that ends after the shift (when the shift window is known).
    if (codes.length === 0 && st.shift.known && completionMin != null && completionMin > st.shift.minutesLeft) codes.push("SHIFT_ENDS_BEFORE_COMPLETION");

    return { verdict: { ...v, eligible: codes.length === 0 }, codes, profile: p, vehicle: v.vehicle, state: st.state, shift: st.shift, mode, startAfterMin, afterRouteId,
      origin, approachKm, approachMin, etaMin, travelSource, capacity, queuedL, remainingL, capacityOk, queuedRoutes,
      totalKm: approachKm != null ? Math.round((approachKm + routeKm) * 10) / 10 : null, totalMin: completionMin };
  });

  // Soft score only among eligible candidates (ineligible ones are listed with reasons, score 0).
  const eligible = raw.filter((c) => c.verdict.eligible);
  const minEta = Math.max(1, Math.min(...eligible.filter((c) => c.etaMin != null).map((c) => c.etaMin), Infinity));
  const maxQueue = Math.max(1, ...eligible.map((c) => c.queuedRoutes));
  for (const c of raw) {
    if (!c.verdict.eligible) { c.score = 0; c.reasons = c.codes.map((k) => REASON_TEXT[k] || k); c.flags = []; continue; }
    const travelScore = c.etaMin == null ? 0.5 : minEta / Math.max(1, c.etaMin); // 1 for the earliest arrival, decays with time
    const capScore = c.capacityOk == null ? 0.5 : c.capacityOk ? 1 : 0;
    // The current route of a next-route candidate is already counted in its later start (etaMin) — not penalised twice.
    const workScore = 1 - Math.max(0, c.queuedRoutes - (c.mode === "next_route" ? 1 : 0)) / maxQueue;
    const locScore = c.origin?.source === "live" || c.origin?.source === "route_end" ? 1 : c.origin?.source === "depot" ? 0.6 : c.origin?.source === "stale_depot" ? 0.4 : 0.2;
    c.score = Math.round(WEIGHTS.travel * travelScore + WEIGHTS.capacity * capScore + WEIGHTS.workload * workScore + WEIGHTS.locationConfidence * locScore);
    c.reasons = ["ضمن النطاق", "في المناوبة ومتاح", `المركبة ${c.vehicle?.vehicleNumber || ""} مؤهلة`.trim()];
    c.flags = [];
    if (c.mode === "next_route") c.reasons.push(`ينهي جولته الحالية خلال ~${c.startAfterMin} د`);
    if (c.approachMin != null) c.reasons.push(`زمن الوصول ${c.approachMin} د (${c.travelSource === "osrm" ? "طرق فعلية" : "تقدير جوي"})`);
    if (c.capacityOk === false) c.flags.push(`السعة المتبقية ${c.remainingL} لتر أقل من تقدير الجولة ${wasteL} لتر`);
    else if (c.capacityOk === null) c.flags.push("سعة المركبة غير مسجلة");
    if (c.queuedRoutes > 0 && c.mode !== "next_route") c.flags.push(`لديه ${c.queuedRoutes} جولة في الانتظار`);
    if (c.origin && !["live", "route_end"].includes(c.origin.source)) c.flags.push(c.origin.label);
    if (!c.origin) c.flags.push("لا يمكن تقدير موقع الانطلاق");
    if (!c.shift.known) c.flags.push("نافذة المناوبة غير مسجلة");
  }
  // A vehicle that cannot physically take the load is never auto-recommended (hard constraint), only listed with the flag.
  const fits = (c) => c.verdict.eligible && c.capacityOk !== false;
  const candidates = [...raw].sort((a, b) => (Number(fits(b)) - Number(fits(a))) || (Number(b.verdict.eligible) - Number(a.verdict.eligible)) || (b.score - a.score) || ((a.etaMin ?? 1e9) - (b.etaMin ?? 1e9)));

  const warnings = [];
  if (profiles.length === 0) warnings.push("لا توجد ملفات سائقين — هيّئها من صفحة السائقين والأسطول");
  else if (eligible.length === 0) warnings.push("لا يوجد سائق مؤهل الآن لهذا الحي — الإسناد الاستثنائي يتطلب مبررًا");
  if (!firstStop) warnings.push("لا إحداثيات لتوقفات الجولة — زمن الوصول غير قابل للحساب");

  if (eligible.length > 0 && !eligible.some(fits)) warnings.push("كل السائقين المؤهلين مركباتهم لا تستوعب حجم الجولة — قسّم الجولة أو أسند استثنائيًا");
  // Nobody fits the load → still recommend the best eligible driver, flagged: the route needs a second trip or a split.
  const capacityShortfall = eligible.length > 0 && !eligible.some(fits);
  const top = candidates.find(fits) || (capacityShortfall ? candidates.find((c) => c.verdict.eligible) : null) || null;

  // Structured reasons — the explanation is built from these codes, never from free text.
  const fitting = eligible.filter(fits).filter((c) => c.etaMin != null);
  const earliest = fitting.length ? fitting.reduce((a, b) => (b.etaMin < a.etaMin ? b : a)) : null;
  const reasonCodes = [];
  if (top) {
    reasonCodes.push("WITHIN_COVERAGE", top.shift.known ? "SHIFT_AVAILABLE" : "SHIFT_END_UNKNOWN");
    reasonCodes.push(top.capacityOk === true ? "SUFFICIENT_CAPACITY" : top.capacityOk === null ? "CAPACITY_UNKNOWN" : "INSUFFICIENT_CAPACITY");
    if (top.mode === "next_route") reasonCodes.push("NEXT_ROUTE_AFTER_CURRENT");
    if (earliest && earliest.profile.uid === top.profile.uid) reasonCodes.push(top.travelSource === "osrm" ? "LOWEST_ELIGIBLE_ROAD_ETA" : "LOWEST_ELIGIBLE_ESTIMATED_ETA");
    else if (earliest) reasonCodes.push("HIGHEST_SCORE_NOT_EARLIEST");
    if (top.origin?.source === "live") reasonCodes.push("LIVE_LOCATION");
    else if (top.origin?.source === "route_end") reasonCodes.push("ORIGIN_ROUTE_END");
    else if (top.origin) reasonCodes.push("ORIGIN_DEPOT_OR_DEFAULT");
  }
  const excluded = candidates.filter((c) => c !== top).map((c) => ({
    driverId: c.profile.uid, driverName: c.profile.fullName || "", state: c.state,
    codes: c.verdict.eligible ? (c.capacityOk === false ? ["INSUFFICIENT_CAPACITY"] : top && c.etaMin != null && top.etaMin != null && c.etaMin > top.etaMin ? ["LATER_ETA"] : ["LOWER_SCORE"]) : c.codes,
    etaMin: c.etaMin, approachMin: c.approachMin, startAfterMin: c.startAfterMin || 0, score: c.score,
  }));

  const recommended = top ? {
    driverId: top.profile.uid, driverName: top.profile.fullName, vehicleId: top.vehicle?.id || null, vehicleNumber: top.vehicle?.vehicleNumber || "",
    scope: (top.profile.neighborhoodKeys || []).map((k) => `حي ${k}`).join("، "), binsCount: stopsCount,
    approachKm: top.approachKm, approachMin: top.approachMin, etaMin: top.etaMin, totalKm: top.totalKm, totalMin: top.totalMin, travelSource: top.travelSource,
    mode: top.mode, startAfterMin: top.startAfterMin, afterRouteId: top.afterRouteId, state: top.state,
    shiftKnown: top.shift.known, shiftMinutesLeft: top.shift.minutesLeft, shiftLabel: top.shift.label || null,
    capacityL: top.capacity || null, queuedL: top.queuedL, remainingL: top.remainingL, routeWasteL: wasteL, routeDriveMin, serviceMin, originSource: top.origin?.source || null,
    routeSource: routeRoad ? "osrm" : "haversine", score: top.score, reasonCodes,
    confidence: capacityShortfall ? "low" : top.travelSource === "osrm" && ["live", "route_end"].includes(top.origin?.source) ? "high" : top.travelSource === "osrm" || top.origin?.source === "live" ? "medium" : "low",
    capacityShortfall,
    reason: [...top.reasons, ...top.flags].join("، "), flags: top.flags,
    // Why not the earliest? Explain when a sooner-but-worse candidate exists.
    nearestOverridden: (() => { const e = eligible.filter((c) => c.etaMin != null).sort((a, b) => a.etaMin - b.etaMin)[0]; return e && e.profile.uid !== top.profile.uid ? `${e.profile.fullName} أقرب (${e.etaMin} د) لكن: ${e.flags.join("، ") || "تقييم أقل"}` : null; })(),
  } : null;

  return { candidates, recommended, warnings, evaluation: { evaluated: raw.length, eligible: eligible.length, excluded },
    assumptions: { minutesPerStop: ASSUMPTIONS.minutesPerStop, avgUrbanSpeedKmh: ASSUMPTIONS.avgUrbanSpeedKmh }, weights: WEIGHTS };
}

/** Arabic text for every structured code (explanations, exclusions). */
export const REASON_TEXT = {
  ACCOUNT_INACTIVE: "الحساب غير مفعّل", OFF_SHIFT: "خارج المناوبة", SHIFT_ENDED: "انتهت مناوبته", DRIVER_UNAVAILABLE: "غير متاح",
  OUTSIDE_COVERAGE: "خارج نطاق التغطية", NO_VEHICLE: "لا توجد مركبة مسندة", VEHICLE_MISSING: "المركبة المسندة غير موجودة", VEHICLE_FAULT: "المركبة متعطلة أو في الصيانة",
  HAS_ACTIVE_ROUTE: "لديه جولة نشطة", BUSY_ON_ROUTE: "في جولة (حجز الجولة التالية غير مفعّل)", BUSY_ROUTE_NOT_STARTED: "لديه جولة معتمدة لم تبدأ",
  NEXT_ROUTE_ALREADY_RESERVED: "له جولة تالية محجوزة", FINISHES_TOO_LATE: "لن ينهي جولته الحالية قريبًا", SHIFT_ENDS_BEFORE_COMPLETION: "تنتهي مناوبته قبل إكمال الجولة",
  INSUFFICIENT_CAPACITY: "سعة المركبة المتبقية لا تكفي", LATER_ETA: "يصل في وقت أبعد", LOWER_SCORE: "تقييم إجمالي أقل",
  WITHIN_COVERAGE: "الحي ضمن نطاق تغطيته", SHIFT_AVAILABLE: "مناوبته تسمح بإكمال الجولة", SHIFT_END_UNKNOWN: "نهاية المناوبة غير مسجلة",
  SUFFICIENT_CAPACITY: "مركبته تستوعب الحمولة", CAPACITY_UNKNOWN: "سعة المركبة غير مسجلة", NEXT_ROUTE_AFTER_CURRENT: "يبدأها فور إنهاء جولته الحالية",
  LOWEST_ELIGIBLE_ROAD_ETA: "الأقرب زمنيًا عبر شبكة الطرق بين المؤهلين", LOWEST_ELIGIBLE_ESTIMATED_ETA: "الأقرب زمنيًا بين المؤهلين (تقدير بالمسافة)",
  HIGHEST_SCORE_NOT_EARLIEST: "الأعلى تقييمًا رغم وجود من يصل أبكر", LIVE_LOCATION: "موقعه المباشر معروف", ORIGIN_ROUTE_END: "الانطلاق من نهاية جولته الحالية",
  ORIGIN_DEPOT_OR_DEFAULT: "الانطلاق من مستودع المركبة (لا موقع مباشر)",
  CHEAPEST_INSERTION: "أقل زمن إضافي بين الجولات القائمة", WITHIN_DETOUR_LIMIT: "الانحراف ضمن الحد المسموح",
};
