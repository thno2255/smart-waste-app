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
import { eligibleDriversFor, locationFreshness, ACTIVE_ROUTE_STATUSES } from "./fleetEngine";
import { haversineDistanceKm, estimateTravelMinutes } from "./decisionEngine";
import { ASSUMPTIONS } from "./impact";

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
 * @param {{distanceKm:number,durationMin:number}|null} [ctx.routeRoad]  REAL road figures for the route itself (OSRM), if known
 * @param {{lat:number,lng:number}} [ctx.defaultOrigin]
 * @param {number} [ctx.now]
 * @returns {{candidates: Array, recommended: object|null, warnings: string[]}}
 */
export function rankDriverCandidates(route, ctx = {}) {
  const { profiles = [], vehicles = [], routes = [], neighborhoodName = "", travelByDriver = {}, routeRoad = null, defaultOrigin = null, now = Date.now() } = ctx;
  const firstStop = (route?.orderedStops || []).find((s) => s.lat != null && s.lng != null) || null;
  const stopsCount = route?.orderedStops?.length || route?.binIds?.length || 0;
  const routeKm = routeRoad?.distanceKm ?? (Number(route?.estimatedDistanceKm) || 0);
  const routeDriveMin = routeRoad?.durationMin ?? estimateTravelMinutes(routeKm);
  const serviceMin = stopsCount * ASSUMPTIONS.minutesPerStop;
  const wasteL = Number(route?.estimatedWasteLiters) || 0;

  const verdicts = eligibleDriversFor(neighborhoodName, { profiles, vehicles, routes: routes.filter((r) => r.id !== route?.id), at: now });
  const raw = verdicts.map((v) => {
    const p = v.profile;
    const origin = driverOrigin(p, v.vehicle, { now, fallback: defaultOrigin });
    const road = travelByDriver[p.uid] || null;
    let approachKm = null, approachMin = null, travelSource = "none";
    if (road) { approachKm = road.distanceKm; approachMin = road.durationMin; travelSource = "osrm"; }
    else if (origin && firstStop) { approachKm = Math.round((haversineDistanceKm(origin.lat, origin.lng, firstStop.lat, firstStop.lng) ?? 0) * 10) / 10; approachMin = estimateTravelMinutes(approachKm); travelSource = "haversine"; }

    const capacity = Number(v.vehicle?.capacityLiters) || 0;
    const queuedL = queuedWasteLiters(p.uid, routes, route?.id);
    const remainingL = capacity ? Math.max(0, capacity - queuedL) : null;
    const capacityOk = remainingL == null ? null : remainingL >= wasteL;
    const queuedRoutes = routes.filter((r) => r.id !== route?.id && r.driverId === p.uid && ACTIVE_ROUTE_STATUSES.includes(r.status)).length;

    return { verdict: v, profile: p, vehicle: v.vehicle, origin, approachKm, approachMin, travelSource, capacity, queuedL, remainingL, capacityOk, queuedRoutes,
      totalKm: approachKm != null ? Math.round((approachKm + routeKm) * 10) / 10 : null,
      totalMin: approachMin != null ? Math.round(approachMin + routeDriveMin + serviceMin) : null };
  });

  // Soft score only among eligible candidates (ineligible ones are listed with reasons, score 0).
  const eligible = raw.filter((c) => c.verdict.eligible);
  const minMin = Math.max(1, Math.min(...eligible.filter((c) => c.approachMin != null).map((c) => c.approachMin), Infinity));
  const maxQueue = Math.max(1, ...eligible.map((c) => c.queuedRoutes));
  for (const c of raw) {
    if (!c.verdict.eligible) { c.score = 0; c.reasons = c.verdict.reasons; c.flags = []; continue; }
    const travelScore = c.approachMin == null ? 0.5 : minMin / Math.max(1, c.approachMin); // 1 for the fastest, decays with time
    const capScore = c.capacityOk == null ? 0.5 : c.capacityOk ? 1 : 0;
    const workScore = 1 - c.queuedRoutes / maxQueue;
    const locScore = c.origin?.source === "live" ? 1 : c.origin?.source === "depot" ? 0.6 : c.origin?.source === "stale_depot" ? 0.4 : 0.2;
    c.score = Math.round(WEIGHTS.travel * travelScore + WEIGHTS.capacity * capScore + WEIGHTS.workload * workScore + WEIGHTS.locationConfidence * locScore);
    c.reasons = ["ضمن النطاق", "في المناوبة ومتاح", `المركبة ${c.vehicle?.vehicleNumber || ""} مؤهلة`.trim()];
    c.flags = [];
    if (c.approachMin != null) c.reasons.push(`زمن الوصول ${c.approachMin} د (${c.travelSource === "osrm" ? "طرق فعلية" : "تقدير جوي"})`);
    if (c.capacityOk === false) c.flags.push(`السعة المتبقية ${c.remainingL} لتر أقل من تقدير الجولة ${wasteL} لتر`);
    else if (c.capacityOk === null) c.flags.push("سعة المركبة غير مسجلة");
    if (c.queuedRoutes > 0) c.flags.push(`لديه ${c.queuedRoutes} جولة في الانتظار`);
    if (c.origin && c.origin.source !== "live") c.flags.push(c.origin.label);
    if (!c.origin) c.flags.push("لا يمكن تقدير موقع الانطلاق");
  }
  // A vehicle that cannot physically take the load is never auto-recommended (hard constraint), only listed with the flag.
  const fits = (c) => c.verdict.eligible && c.capacityOk !== false;
  const candidates = [...raw].sort((a, b) => (Number(fits(b)) - Number(fits(a))) || (Number(b.verdict.eligible) - Number(a.verdict.eligible)) || (b.score - a.score) || ((a.approachMin ?? 1e9) - (b.approachMin ?? 1e9)));

  const warnings = [];
  if (profiles.length === 0) warnings.push("لا توجد ملفات سائقين — هيّئها من صفحة السائقين والأسطول");
  else if (eligible.length === 0) warnings.push("لا يوجد سائق مؤهل الآن لهذا الحي — الإسناد الاستثنائي يتطلب مبررًا");
  if (!firstStop) warnings.push("لا إحداثيات لتوقفات الجولة — زمن الوصول غير قابل للحساب");

  if (eligible.length > 0 && !eligible.some(fits)) warnings.push("كل السائقين المؤهلين مركباتهم لا تستوعب حجم الجولة — قسّم الجولة أو أسند استثنائيًا");
  // Nobody fits the load → still recommend the best eligible driver, flagged: the route needs a second trip or a split.
  const capacityShortfall = eligible.length > 0 && !eligible.some(fits);
  const top = candidates.find(fits) || (capacityShortfall ? candidates.find((c) => c.verdict.eligible) : null) || null;
  const recommended = top ? {
    driverId: top.profile.uid, driverName: top.profile.fullName, vehicleId: top.vehicle?.id || null, vehicleNumber: top.vehicle?.vehicleNumber || "",
    scope: (top.profile.neighborhoodKeys || []).map((k) => `حي ${k}`).join("، "), binsCount: stopsCount,
    approachKm: top.approachKm, approachMin: top.approachMin, totalKm: top.totalKm, totalMin: top.totalMin, travelSource: top.travelSource,
    routeSource: routeRoad ? "osrm" : "haversine", score: top.score,
    confidence: capacityShortfall ? "low" : top.travelSource === "osrm" && top.origin?.source === "live" ? "high" : top.travelSource === "osrm" || top.origin?.source === "live" ? "medium" : "low",
    capacityShortfall,
    reason: [...top.reasons, ...top.flags].join("، "), flags: top.flags,
    // Why not the nearest? Explain when a closer-but-worse candidate exists.
    nearestOverridden: (() => { const nearest = eligible.filter((c) => c.approachMin != null).sort((a, b) => a.approachMin - b.approachMin)[0]; return nearest && nearest.profile.uid !== top.profile.uid ? `${nearest.profile.fullName} أقرب (${nearest.approachMin} د) لكن: ${nearest.flags.join("، ") || "تقييم أقل"}` : null; })(),
  } : null;

  return { candidates, recommended, warnings, assumptions: { minutesPerStop: ASSUMPTIONS.minutesPerStop, avgUrbanSpeedKmh: ASSUMPTIONS.avgUrbanSpeedKmh }, weights: WEIGHTS };
}
