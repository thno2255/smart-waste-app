/**
 * impact.js
 * ─────────────────────────────────────────────────────────────────────
 * Measurable-impact and fleet-performance figures, derived ONLY from live
 * data (bins, routes, collection events, audit log). Every number states
 * the assumption behind it (ASSUMPTIONS below) so a judge can challenge it
 * rather than take a marketing figure on faith. Pure module — no Firestore,
 * no React.
 * ─────────────────────────────────────────────────────────────────────
 */
import { haversineDistanceKm, orderStopsFrom, getRouteEligibility } from "./decisionEngine.js";

export const ASSUMPTIONS = {
  truckFuelLitersPerKm: 0.35,   // typical 6–8 ton rear-loader in urban stop-and-go traffic
  co2KgPerLiterDiesel: 2.68,    // IPCC default emission factor for diesel
  minutesPerStop: 4,            // average time to service one bin
  fuelPricePerLiter: 1.15,      // SAR per litre of diesel (announced assumption for estimated cost)
  crewCostPerHour: 120,         // SAR per crew-hour (driver + vehicle running cost), estimated
  avgUrbanSpeedKmh: 30,
  fixedScheduleVisitsPerDay: 1, // the baseline being replaced: every bin visited once a day regardless of fill
};

/**
 * Factors for converting distance into fuel and emissions. Adjustable by the Amanah (dispatch_settings.impactFactors);
 * a factor set to null makes the dependent figure "غير متاح" instead of guessing.
 */
export const DEFAULT_IMPACT_FACTORS = {
  fuelLitersPerKm: ASSUMPTIONS.truckFuelLitersPerKm,
  co2KgPerLiter: ASSUMPTIONS.co2KgPerLiterDiesel,
  avgUrbanSpeedKmh: ASSUMPTIONS.avgUrbanSpeedKmh,
};
export const IMPACT_FACTOR_SOURCES = {
  fuelLitersPerKm: "افتراض تشغيلي لشاحنة ضاغطة 6–8 طن في حركة حضرية متقطعة — غير معايَر بقياس استهلاك أسطول فعلي؛ يُستبدل بمتوسط استهلاك الأسطول عند توفره",
  co2KgPerLiter: "معامل انبعاث الديزل الافتراضي — IPCC 2006 Guidelines, Vol. 2, Ch. 3 (74,100 kgCO2/TJ ≈ 2.68 كجم/لتر)",
  avgUrbanSpeedKmh: "افتراض متوسط سرعة حضرية لتحويل المسافة إلى زمن عند غياب بيانات الطرق",
};

/**
 * "What did data-driven collection save TODAY versus a fixed daily schedule?"
 *
 * Baseline = a fixed schedule that visits EVERY bin once (one route per
 * neighborhood through all its bins). Data-driven = only the bins the
 * engine currently flags as eligible (critical / high / predicted full
 * soon). The difference is the avoided work.
 *
 * @param {Array<object>} groups from groupNeighborhoodsByName()
 * @param {Array<{bin:object, priority:object}>} scoredBins
 * @param {Array<object>} routes
 * @param {{depot?:{lat:number,lng:number}}} [opts]
 */
export function computeImpactMetrics(groups = [], scoredBins = [], routes = [], opts = {}) {
  const depot = opts.depot || null;
  let baselineKm = 0, dataDrivenKm = 0;
  let baselineStops = 0, dataDrivenStops = 0;

  for (const g of groups) {
    const idSet = new Set(g.ids);
    const nScored = scoredBins.filter((s) => idSet.has(s.bin.neighborhoodId) && s.bin.lat != null && s.bin.lng != null);
    if (nScored.length === 0) continue;
    const eligible = nScored.filter((s) => getRouteEligibility(s.bin, s.priority).eligible);

    const base = orderStopsFrom(depot, nScored);
    baselineKm += base.totalDistanceKm + legBack(depot, base.orderedStops);
    baselineStops += nScored.length;

    if (eligible.length > 0) {
      const dd = orderStopsFrom(depot, eligible);
      dataDrivenKm += dd.totalDistanceKm + legBack(depot, dd.orderedStops);
      dataDrivenStops += eligible.length;
    }
  }

  const kmSaved = Math.max(0, baselineKm - dataDrivenKm);
  const stopsAvoided = Math.max(0, baselineStops - dataDrivenStops);
  const fuelSavedL = kmSaved * ASSUMPTIONS.truckFuelLitersPerKm;
  const co2SavedKg = fuelSavedL * ASSUMPTIONS.co2KgPerLiterDiesel;
  const minutesSaved = (kmSaved / ASSUMPTIONS.avgUrbanSpeedKmh) * 60 + stopsAvoided * ASSUMPTIONS.minutesPerStop;

  // Overflow prevented: bins predicted full within the horizon that are already covered by an open route.
  const openRouteBinIds = new Set(routes.filter((r) => ["suggested", "approved", "in_progress"].includes(r.status)).flatMap((r) => r.binIds || []));
  const overflowsPrevented = scoredBins.filter((s) => (s.priority.tier === "critical" || s.priority.prediction?.predictionAvailable && s.priority.prediction.hoursToFull <= 3) && openRouteBinIds.has(s.bin.id)).length;

  const neighborhoodsSkipped = groups.filter((g) => {
    const idSet = new Set(g.ids);
    const nScored = scoredBins.filter((s) => idSet.has(s.bin.neighborhoodId));
    return nScored.length > 0 && !nScored.some((s) => getRouteEligibility(s.bin, s.priority).eligible);
  }).length;

  return {
    baselineKm: round1(baselineKm), dataDrivenKm: round1(dataDrivenKm), kmSaved: round1(kmSaved),
    baselineStops, dataDrivenStops, stopsAvoided, neighborhoodsSkipped,
    fuelSavedL: round1(fuelSavedL), co2SavedKg: round1(co2SavedKg), minutesSaved: Math.round(minutesSaved),
    reductionPct: baselineKm > 0 ? Math.round((kmSaved / baselineKm) * 100) : 0,
    overflowsPrevented,
    assumptions: ASSUMPTIONS,
  };
}

function legBack(depot, orderedStops) {
  if (!depot || orderedStops.length === 0) return 0;
  const last = orderedStops[orderedStops.length - 1];
  return haversineDistanceKm(last.lat, last.lng, depot.lat, depot.lng) ?? 0;
}
const round1 = (v) => Math.round(v * 10) / 10;

/**
 * Driver / vehicle performance from completed routes, collection events and
 * the audit log (skips, faults, obstacles).
 *
 * @returns {{vehicles:Array<object>, drivers:Array<object>, totals:object}}
 */
export function computeFleetPerformance(routes = [], events = [], auditLog = [], vehicles = []) {
  const completed = routes.filter((r) => r.status === "completed" && r.startedAt && r.completedAt);
  const eventsByRoute = groupBy(events, (e) => e.routeId);
  const skipsByRoute = groupBy(auditLog.filter((a) => a.action === "route_stop_skipped"), (a) => a.details?.routeId);
  const incidentsByRoute = groupBy(auditLog.filter((a) => a.action === "route_fault_reported" || a.action === "route_obstacle_reported"), (a) => a.details?.routeId);

  const perRoute = completed.map((r) => {
    const actualMin = Math.max(1, Math.round((new Date(r.completedAt) - new Date(r.startedAt)) / 60000));
    const plannedMin = Math.round(((r.estimatedDistanceKm || 0) / ASSUMPTIONS.avgUrbanSpeedKmh) * 60 + (r.binIds?.length || 0) * ASSUMPTIONS.minutesPerStop);
    const collected = (eventsByRoute[r.id] || []).length;
    const skipped = (skipsByRoute[r.id] || []).length;
    const planned = r.binIds?.length || 0;
    const avgFillAtCollection = avg((eventsByRoute[r.id] || []).map((e) => Number(e.fillBefore)).filter((v) => !Number.isNaN(v)));
    const approvalToStartMin = r.approvedAt && r.startedAt ? Math.round((new Date(r.startedAt) - new Date(r.approvedAt)) / 60000) : null;
    return {
      routeId: r.id, routeName: r.routeName, vehicleId: r.vehicleId || null, driverId: r.driverId || r.completedBy || null, driverName: r.driverName || null,
      plannedMin, actualMin, onTime: actualMin <= plannedMin * 1.2,
      planned, collected, skipped, completionPct: planned ? Math.round((collected / planned) * 100) : 0,
      avgFillAtCollection: avgFillAtCollection != null ? Math.round(avgFillAtCollection) : null,
      incidents: (incidentsByRoute[r.id] || []).length,
      approvalToStartMin, completedAt: r.completedAt, distanceKm: r.estimatedDistanceKm || 0,
    };
  });

  const byVehicle = groupBy(perRoute, (p) => p.vehicleId || "__none");
  const vehicleRows = vehicles.map((v) => summarize(v.id, v.vehicleNumber, byVehicle[v.id] || [], v)).filter((row) => row.routes > 0 || true);
  const byDriver = groupBy(perRoute, (p) => p.driverId || "__unassigned");
  const driverRows = Object.entries(byDriver).map(([id, rows]) => summarize(id, rows[0]?.driverName || (id === "__unassigned" ? "غير محدد" : id), rows));

  const totals = summarize("all", "الكل", perRoute);
  return { perRoute: perRoute.sort((a, b) => (a.completedAt < b.completedAt ? 1 : -1)), vehicles: vehicleRows, drivers: driverRows, totals };
}

function summarize(id, label, rows, vehicle = null) {
  const routesCount = rows.length;
  return {
    id, label, routes: routesCount,
    km: round1(rows.reduce((a, r) => a + r.distanceKm, 0)),
    collected: rows.reduce((a, r) => a + r.collected, 0),
    skipped: rows.reduce((a, r) => a + r.skipped, 0),
    incidents: rows.reduce((a, r) => a + r.incidents, 0),
    onTimePct: routesCount ? Math.round((rows.filter((r) => r.onTime).length / routesCount) * 100) : null,
    avgActualVsPlannedPct: routesCount ? Math.round(avg(rows.map((r) => (r.actualMin / Math.max(1, r.plannedMin)) * 100))) : null,
    avgFillAtCollection: (() => { const v = rows.map((r) => r.avgFillAtCollection).filter((x) => x != null); return v.length ? Math.round(avg(v)) : null; })(),
    avgApprovalToStartMin: (() => { const v = rows.map((r) => r.approvalToStartMin).filter((x) => x != null); return v.length ? Math.round(avg(v)) : null; })(),
    status: vehicle?.status || null,
  };
}

function groupBy(arr, keyFn) {
  const out = {};
  for (const item of arr) { const k = keyFn(item); if (k == null) continue; (out[k] ||= []).push(item); }
  return out;
}
function avg(arr) { return arr.length ? arr.reduce((a, v) => a + v, 0) / arr.length : null; }

/**
 * "الأداء والأثر" — realised vs expected, for a time window.
 *
 * Distance saved is measured against a REFERENCE ROUTE over the SAME bins, from the SAME depot,
 * with the same vehicle: the urgency-first order a dispatcher would follow without optimisation
 * (decisionExplain.referenceOrder). Both sides use the same straight-line metric so they are comparable.
 *   • realised  — completed routes, only the bins actually collected (collection_events), in the order
 *                 they were confirmed;
 *   • expected  — approved / in-progress routes, planned stops in planned order.
 * Fuel = km saved × fuel L/km; CO2 = fuel × emission factor (DEFAULT_IMPACT_FACTORS, adjustable).
 * Any figure without the data it needs is null — the UI shows "غير متاح", never 0.
 *
 * @param {object} p { routes, events, decisions, vehicles, targets, factors, from, to }
 */
export function computeOperationalImpact({ routes = [], events = [], decisions = [], vehicles = [], targets = {}, factors = DEFAULT_IMPACT_FACTORS, from = null, to = Date.now(), referenceOrder, pathKm }) {
  const inWindow = (iso) => { if (!iso) return false; const t = new Date(iso).getTime(); return (from == null || t >= from) && t <= to; };
  const vehicleById = new Map(vehicles.map((v) => [v.id, v]));
  const depotOf = (r) => { const v = vehicleById.get(r.vehicleId); return v?.depotLat != null ? { lat: v.depotLat, lng: v.depotLng } : null; };
  const eventsByRoute = groupBy(events.filter((e) => inWindow(e.confirmedAt || e.collectedAt)), (e) => e.routeId);
  const fuelOf = (km) => (km == null || factors.fuelLitersPerKm == null ? null : round1(km * factors.fuelLitersPerKm));
  const co2Of = (fuel) => (fuel == null || factors.co2KgPerLiter == null ? null : round1(fuel * factors.co2KgPerLiter));
  const hoursOf = (km) => (km == null || !factors.avgUrbanSpeedKmh ? null : round1(km / factors.avgUrbanSpeedKmh));
  const target = targets.criticalCollectionMin ?? null;

  // ── realised ──
  const completed = routes.filter((r) => r.status === "completed" && inWindow(r.completedAt));
  let actualKm = 0, refKm = 0, measuredRoutes = 0;
  const responses = [], critical = [];
  let loadL = 0, capL = 0, utilRoutes = 0;
  for (const r of completed) {
    const evs = (eventsByRoute[r.id] || []).sort((a, b) => String(a.confirmedAt).localeCompare(String(b.confirmedAt)));
    const stopById = new Map((r.orderedStops || []).map((s) => [s.binId, s]));
    const done = evs.map((e) => ({ ...(stopById.get(e.binId) || {}), binId: e.binId, fillLevelPercent: e.fillBefore })).filter((s) => s.lat != null);
    const depot = depotOf(r);
    if (depot && done.length >= 2) { actualKm += pathKm(depot, done); refKm += pathKm(depot, referenceOrder(done)); measuredRoutes += 1; }
    const t0 = r.dispatch?.at || r.approvedAt;
    for (const e of evs) {
      if (!t0) continue;
      const m = Math.round((new Date(e.confirmedAt) - new Date(t0)) / 60000);
      if (m < 0) continue;
      responses.push(m);
      if (Number(e.fillBefore) >= 85) critical.push(m);
    }
    const cap = Number(vehicleById.get(r.vehicleId)?.capacityLiters) || null;
    if (cap && evs.length) { loadL += evs.reduce((a, e) => a + 1100 * Math.min(100, Number(e.fillBefore) || 0) / 100, 0); capL += cap; utilRoutes += 1; }
  }
  const kmSaved = measuredRoutes ? round1(Math.max(0, refKm - actualKm)) : null;
  const late = target != null ? critical.filter((m) => m > target).length : null;
  const autoExecuted = decisions.filter((d) => d.status === "executed" && ["create_assign", "insert", "reassign"].includes(d.type) && inWindow(d.executedAt || d.updatedAt));
  const collectedIds = new Set(events.filter((e) => inWindow(e.confirmedAt || e.collectedAt)).map((e) => `${e.routeId}|${e.binId}`));
  const autoSucceeded = autoExecuted.filter((d) => d.routeId && (d.binIds || []).some((b) => collectedIds.has(`${d.routeId}|${b}`)));
  const realised = {
    routesCompleted: completed.length,
    binsCollected: Object.values(eventsByRoute).reduce((a, l) => a + l.length, 0),
    measuredRoutes, distanceKm: measuredRoutes ? round1(actualKm) : null, referenceKm: measuredRoutes ? round1(refKm) : null,
    kmSaved, fuelL: fuelOf(kmSaved), co2Kg: co2Of(fuelOf(kmSaved)), hoursSaved: hoursOf(kmSaved),
    criticalMeasured: critical.length,
    onTimePct: target != null && critical.length ? Math.round((critical.filter((m) => m <= target).length / critical.length) * 100) : null,
    lateCritical: critical.length ? late : null,
    avgResponseMin: responses.length ? Math.round(avg(responses)) : null,
    utilizationPct: utilRoutes ? Math.round((loadL / capL) * 100) : null,
    autoDecisionsExecuted: autoExecuted.length, autoDecisionsSucceeded: autoSucceeded.length,
  };

  // ── expected (planned, not yet done) ──
  const active = routes.filter((r) => ["approved", "in_progress"].includes(r.status));
  let eKm = 0, eRef = 0, eMeasured = 0; const eCompletion = [];
  for (const r of active) {
    const stored = r.dispatch?.explanation?.impact;
    if (stored && stored.referenceKm != null) { eKm += stored.routeKm; eRef += stored.referenceKm; eMeasured += 1; }
    else { const depot = depotOf(r); const st = (r.orderedStops || []).filter((s) => s.lat != null); if (depot && st.length >= 2) { eKm += pathKm(depot, st); eRef += pathKm(depot, referenceOrder(st)); eMeasured += 1; } }
    if (r.expectedCollectionMin != null) eCompletion.push(r.expectedCollectionMin);
  }
  const eSaved = eMeasured ? round1(Math.max(0, eRef - eKm)) : null;
  const expected = {
    routesPlanned: active.length, binsPlanned: active.reduce((a, r) => a + (r.binIds?.length || 0), 0), measuredRoutes: eMeasured,
    kmSaved: eSaved, fuelL: fuelOf(eSaved), co2Kg: co2Of(fuelOf(eSaved)), hoursSaved: hoursOf(eSaved),
    avgExpectedCollectionMin: eCompletion.length ? Math.round(avg(eCompletion)) : null,
  };
  return { window: { from: from != null ? new Date(from).toISOString() : null, to: new Date(to).toISOString() }, realised, expected, targets, factors,
    basis: "المسافة الموفرة = المسار المرجعي (الأكثر إلحاحًا أولًا) − مسار التنفيذ، لنفس الحاويات ونفس المستودع، بقياس جوي موحد" };
}
