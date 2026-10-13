/**
 * collectionPlanner.js — Phase 4: Municipal Collection Optimization Engine.
 * ─────────────────────────────────────────────────────────────────────
 * One call builds a complete, explainable collection plan for a municipality
 * from the engines that already exist (no logic duplicated here):
 *
 *   decisionEngine   → priority per bin, route eligibility, one route per neighborhood
 *   routeOptimizer   → visiting order under vehicle capacity / priority (time matrix: OSRM or Haversine, labelled)
 *   assignmentEngine → recommended driver + vehicle per route (coverage, shift, capacity, workload, travel time)
 *   impact           → fair baseline vs plan (same bins, same depot, same assumptions)
 *
 * The plan reports what it could NOT serve and why (no eligible driver, capacity,
 * no coordinates), never a "perfect" solution. Pure: no React, no Firestore.
 * ─────────────────────────────────────────────────────────────────────
 */
import { getBinPriority, getRouteEligibility, recommendRoutes } from "./decisionEngine";
import { optimizeRoute, haversineMatrix } from "./routeOptimizer";
import { haversineDistanceKm } from "./decisionEngine";
import { rankDriverCandidates } from "./assignmentEngine";
import { ACTIVE_ROUTE_STATUSES } from "./fleetEngine";
import { ASSUMPTIONS } from "./impact";

/**
 * @param {object} input
 * @param {string} input.municipalityId
 * @param {Array}  input.neighborhoods   docs of THIS municipality (id, name)
 * @param {Array}  input.bins            bins of this municipality (lat/lng, lastFillLevelPercent, capacityLiters, …)
 * @param {Array}  input.profiles        driver profiles of this municipality
 * @param {Array}  input.vehicles        vehicles of this municipality
 * @param {Array}  input.routes          existing routes (open ones lock their bins; drivers' workload)
 * @param {Object<string,Array>} [input.readingsByBin]  recent readings per bin (prediction)
 * @param {(bin)=>object} [input.contextFor]  thermal/citizen context per bin
 * @param {{lat,lng,label?}} input.depot
 * @param {Object<string,{durations,distances,source}>} [input.matrixByNeighborhood]  pre-fetched OSRM table per neighborhood id (index 0 = depot)
 * @param {Array<{lat,lng,label}>} [input.dumpSites]
 * @param {number} [input.now]
 */
export function buildCollectionPlan(input) {
  const { municipalityId, neighborhoods = [], bins = [], profiles = [], vehicles = [], routes = [], readingsByBin = {}, contextFor = () => ({}), depot, matrixByNeighborhood = {}, dumpSites = [], now = Date.now() } = input;
  const constraints = [];
  if (!depot || depot.lat == null) constraints.push("لا توجد نقطة انطلاق (مستودع) — المسافات محسوبة من الموقع الافتراضي");
  const start = depot && depot.lat != null ? depot : { lat: 26.334, lng: 43.972, label: "موقع افتراضي" };

  // 1. Score + eligibility (prediction included through recent readings).
  const scored = bins.map((bin) => ({ bin, priority: getBinPriority(bin, null, readingsByBin[bin.id] || [], contextFor(bin)) }));
  const eligibility = scored.map((s) => ({ ...s, eligibility: getRouteEligibility(s.bin, s.priority) }));
  const needCollection = eligibility.filter((s) => s.eligibility.eligible);
  const excluded = eligibility.filter((s) => !s.eligibility.eligible && (s.priority.tier === "critical" || s.priority.tier === "high"))
    .map((s) => ({ binId: s.bin.id, binName: s.bin.name, reason: s.eligibility.reason, tier: s.priority.tier }));

  // 2. Lock bins already on approved/active routes.
  const locked = new Set(routes.filter((r) => ACTIVE_ROUTE_STATUSES.includes(r.status)).flatMap((r) => r.binIds || []));
  const candidates = needCollection.filter((s) => !locked.has(s.bin.id));
  const lockedCount = needCollection.length - candidates.length;

  // 3. One proposed route per neighborhood (existing engine), then optimize each with the best-fitting vehicle.
  const proposed = recommendRoutes(neighborhoods, candidates);
  const usableVehicles = vehicles.filter((v) => v.status === "available" || v.status === "on_route");
  const planRoutes = [];
  const unassigned = [];
  const usedDrivers = new Set();
  let totalKm = 0, totalMin = 0, totalWaste = 0, served = 0, deferred = 0;

  for (const r of proposed) {
    const nName = neighborhoods.find((n) => n.id === r.neighborhoodIds?.[0])?.name || "";
    const stops = r.orderedStops.map((s) => { const bin = bins.find((b) => b.id === s.binId) || {}; const fill = Number(bin.lastFillLevelPercent) || 0; return { binId: s.binId, binName: s.binName, lat: bin.lat ?? null, lng: bin.lng ?? null, priorityTier: s.priorityTier, priorityScore: s.priorityScore, fillLevelPercent: bin.lastFillLevelPercent ?? null, wasteLiters: Math.round((Number(bin.capacityLiters) || 1100) * fill / 100) }; });
    // Driver first (determines the vehicle/capacity the order must respect).
    // Drivers already taken by an earlier route of this plan are presented as busy (not hidden), so the reason is explicit.
    const profilesForRec = profiles.map((p) => (usedDrivers.has(p.uid) ? { ...p, availability: "unavailable" } : p));
    const rec = rankDriverCandidates({ ...r, orderedStops: stops, estimatedWasteLiters: stops.reduce((a, s) => a + s.wasteLiters, 0) }, { profiles: profilesForRec, vehicles, routes, neighborhoodName: nName, defaultOrigin: start, now });
    const vehicle = rec.recommended ? vehicles.find((v) => v.id === rec.recommended.vehicleId) : (usableVehicles[0] || null);
    const capacity = Number(vehicle?.capacityLiters) || null;
    const matrix = matrixByNeighborhood[r.neighborhoodIds?.[0]] || undefined;
    const opt = optimizeRoute({ start, stops, capacityLiters: capacity, dumpSite: dumpSites[0] || null, matrix: matrix && matrix.durations?.length === stops.filter((s) => s.lat != null).length + 1 + (dumpSites[0] ? 1 : 0) ? matrix : undefined, timeWindow: { startAt: now } });
    const routePlan = {
      neighborhoodId: r.neighborhoodIds?.[0], neighborhoodName: nName, routeName: r.routeName, reasons: r.reasons,
      stops: opt.ok ? opt.orderedStops.filter((o) => o.type === "stop") : stops.map((s, i) => ({ ...s, order: i + 1 })),
      deferredStops: opt.ok ? opt.deferredStops : [],
      distanceKm: opt.ok ? opt.totalDistanceKm : r.estimatedDistanceKm, durationMin: opt.ok ? opt.totalDurationMin : null, trips: opt.ok ? opt.trips : 1,
      wasteLiters: opt.ok ? opt.estimatedWasteLiters : stops.reduce((a, s) => a + s.wasteLiters, 0),
      matrixSource: opt.ok ? opt.matrixSource : "none", confidence: opt.ok ? opt.confidence : "low", constraints: opt.ok ? opt.constraints : ["تعذر التحسين"],
      driver: rec.recommended ? { driverId: rec.recommended.driverId, driverName: rec.recommended.driverName, vehicleId: rec.recommended.vehicleId, vehicleNumber: rec.recommended.vehicleNumber, reason: rec.recommended.reason, approachMin: rec.recommended.approachMin, travelSource: rec.recommended.travelSource, capacityShortfall: !!rec.recommended.capacityShortfall } : null,
      driverWarnings: rec.warnings, candidates: rec.candidates.length,
      priorityTier: r.priorityTier, totalPriorityScore: r.totalPriorityScore,
    };
    if (rec.recommended) usedDrivers.add(rec.recommended.driverId); else unassigned.push({ routeName: r.routeName, neighborhoodName: nName, reasons: rec.warnings.length ? rec.warnings : ["لا يوجد سائق مؤهل"] });
    planRoutes.push(routePlan);
    totalKm += routePlan.distanceKm || 0; totalMin += routePlan.durationMin || 0; totalWaste += routePlan.wasteLiters || 0; served += routePlan.stops.length; deferred += routePlan.deferredStops.length;
  }

  // 4. Fair baseline: the fixed daily schedule — one tour per neighborhood from the SAME depot visiting EVERY bin
  //    of that neighborhood (same structure as the plan: one route per neighborhood), Haversine for both sides.
  const baseline = baselineForBins(bins, start, neighborhoods);
  // Same basis on both sides: the plan's visiting order measured with Haversine too (OSRM road km would not be comparable).
  const planComparableKm = planRoutes.reduce((a, r) => a + haversineTourKm(start, r.stops), 0);
  const kmSaved = Math.round((baseline.km - planComparableKm) * 10) / 10; // signed: negative = the plan is longer than the baseline
  const comparable = baseline.binsWithCoords > 0 && planRoutes.length > 0;

  // 5. Honest summary.
  if (lockedCount > 0) constraints.push(`${lockedCount} حاوية مؤهلة مرتبطة بجولات معتمدة/نشطة بالفعل — لم تُضمَّن مجددًا`);
  if (unassigned.length) constraints.push(`${unassigned.length} جولة بلا سائق مؤهل — تحتاج إسنادًا استثنائيًا أو دعمًا`);
  if (deferred > 0) constraints.push(`${deferred} حاوية مؤجلة لتجاوز سعة المركبات${dumpSites.length ? "" : " (لا نقاط تفريغ معرفة)"}`);
  if (excluded.length) constraints.push(`${excluded.length} حاوية حرجة/مرتفعة مستبعدة من الجمع التلقائي (مستشعر منقطع أو خلل) — تحتاج فحصًا يدويًا`);

  return {
    municipalityId, generatedAt: new Date(now).toISOString(),
    summary: { needCollection: needCollection.length, locked: lockedCount, routes: planRoutes.length, served, deferred, unassignedRoutes: unassigned.length, excluded: excluded.length, totalKm: Math.round(totalKm * 10) / 10, totalMin: Math.round(totalMin), totalWasteLiters: Math.round(totalWaste),
      baselineKm: baseline.km, planComparableKm: Math.round(planComparableKm * 10) / 10, kmSaved, reductionPct: comparable && baseline.km > 0 ? Math.round((kmSaved / baseline.km) * 100) : null, fuelSavedL: comparable ? Math.round(kmSaved * ASSUMPTIONS.truckFuelLitersPerKm * 10) / 10 : null,
      confidence: planRoutes.length === 0 ? "none" : planRoutes.every((r) => r.matrixSource === "osrm") ? "high" : planRoutes.some((r) => r.matrixSource === "osrm") ? "medium" : "low" },
    routes: planRoutes, unassigned, excluded, constraints,
    assumptions: { minutesPerStop: ASSUMPTIONS.minutesPerStop, avgUrbanSpeedKmh: ASSUMPTIONS.avgUrbanSpeedKmh, truckFuelLitersPerKm: ASSUMPTIONS.truckFuelLitersPerKm, baseline: "زيارة كل حاوية في البلدية مرة واحدة من نفس المستودع بنفس سرعة وزمن الخدمة (مسافات جوية)" },
  };
}

/** Haversine length of a given stop order from the depot (comparison basis). */
function haversineTourKm(start, stops) {
  let prev = start, km = 0;
  for (const s of stops) { if (s.lat == null) continue; km += haversineDistanceKm(prev.lat, prev.lng, s.lat, s.lng) ?? 0; prev = s; }
  return km;
}

/** Baseline: per neighborhood, a nearest-neighbor tour from the depot over ALL its bins (fixed daily schedule). */
function baselineForBins(bins, start, neighborhoods = []) {
  let km = 0, binsWithCoords = 0;
  const groups = neighborhoods.length ? neighborhoods.map((n) => bins.filter((b) => b.neighborhoodId === n.id)) : [bins];
  for (const group of groups) {
    const pts = group.filter((b) => b.lat != null && b.lng != null).map((b) => ({ lat: b.lat, lng: b.lng }));
    if (pts.length === 0) continue;
    binsWithCoords += pts.length;
    const m = haversineMatrix([start, ...pts]);
    const remaining = pts.map((_, i) => i + 1); let cur = 0;
    while (remaining.length) { let bi = 0; for (let i = 1; i < remaining.length; i++) if (m.distances[cur][remaining[i]] < m.distances[cur][remaining[bi]]) bi = i; const nxt = remaining.splice(bi, 1)[0]; km += m.distances[cur][nxt]; cur = nxt; }
  }
  return { km: Math.round(km * 10) / 10, binsWithCoords };
}

/** Human explanation of one planned route — every sentence traces to a computed field. */
export function explainRoute(r) {
  const parts = [];
  parts.push(`${r.stops.length} حاوية في ${r.neighborhoodName}${r.deferredStops.length ? ` (+${r.deferredStops.length} مؤجلة لتجاوز السعة)` : ""}`);
  if (r.reasons?.length) parts.push(r.reasons[0]);
  parts.push(`${r.distanceKm} كم${r.durationMin != null ? ` · ~${r.durationMin} د` : ""} (${r.matrixSource === "osrm" ? "طرق فعلية" : "تقدير جوي"})`);
  if (r.driver) parts.push(`السائق المقترح ${r.driver.driverName} — ${r.driver.vehicleNumber}${r.driver.approachMin != null ? ` · وصول ${r.driver.approachMin} د` : ""}${r.driver.capacityShortfall ? " · تحذير: السعة لا تكفي لرحلة واحدة" : ""}`);
  else parts.push("لا سائق مؤهل: " + (r.driverWarnings?.[0] || "—"));
  return parts.join(" · ");
}

/**
 * Explainable additions: bins predicted to reach the critical level soon that are
 * NOT in the plan but lie within `maxKm` of a planned route's stops. Each
 * suggestion carries the computed facts the sentence is built from.
 */
export function suggestAdditions(plan, bins = [], predictedSoonIds = new Set(), { maxKm = 1 } = {}) {
  const planned = new Set(plan.routes.flatMap((r) => [...r.stops, ...r.deferredStops].map((s) => s.binId)));
  const out = [];
  for (const b of bins) {
    if (!predictedSoonIds.has(b.id) || planned.has(b.id) || b.lat == null) continue;
    let best = null;
    for (const r of plan.routes) for (const s of r.stops) { if (s.lat == null) continue; const km = haversineDistanceKm(b.lat, b.lng, s.lat, s.lng) ?? 99; if (km <= maxKm && (!best || km < best.km)) best = { route: r, km: Math.round(km * 100) / 100, near: s.binName }; }
    if (best) out.push({ binId: b.id, binName: b.name, routeName: best.route.routeName, neighborhoodName: best.route.neighborhoodName, km: best.km, near: best.near, fill: b.lastFillLevelPercent });
  }
  const byRoute = {};
  for (const s of out) (byRoute[s.routeName] ||= []).push(s);
  const sentences = Object.entries(byRoute).map(([routeName, items]) => `يوصى بإضافة ${items.length} حاوية إلى ${routeName}، لأن التنبؤات تشير إلى وصولها للمستوى الحرج خلال ساعات، وتقع ضمن ${maxKm} كم من مسار الجولة (${items.map((i) => `${i.binName} على بعد ${i.km} كم من ${i.near}`).join("، ")}).`);
  return { suggestions: out, sentences };
}
