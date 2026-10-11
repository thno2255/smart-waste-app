/**
 * interMunicipalEngine.js — Phase 5: Inter-Municipality Resource Optimization Engine.
 * ─────────────────────────────────────────────────────────────────────
 * Amanah-level, pure. From the six municipalities' live state it computes:
 *   • operational pressure per municipality (demand vs. capacity), explainable
 *   • shortages (where demand exceeds what available drivers/vehicles can serve)
 *   • transfer candidates (vehicle or driver) that respect operational constraints
 *   • the IMPACT of each transfer on BOTH sides (pressure before/after), the
 *     transfer cost (travel time between municipality centroids, real road time
 *     when supplied) and a net benefit, so the recommendation is never
 *     "the other municipality has one more truck".
 * Nothing moves here: outputs are recommendations for the decision maker.
 * ─────────────────────────────────────────────────────────────────────
 */
import { haversineDistanceKm, estimateTravelMinutes } from "./decisionEngine";
import { ACTIVE_ROUTE_STATUSES } from "./fleetEngine";
import { ASSUMPTIONS } from "./impact";

/** Demand units: a critical bin counts 1, a warning/predicted-soon bin 0.5, an open suggested route adds 0.5 per 5 bins. */
export const PRESSURE_WEIGHTS = { critical: 1, warning: 0.5, predictedSoon: 0.5, openIncident: 0.5 };
/** Capacity units per hour of one available crew (driver + vehicle): bins it can service in the remaining shift. */
export const CREW_BINS_PER_HOUR = 60 / (ASSUMPTIONS.minutesPerStop + 4); // service + ~4 min drive between stops

/**
 * @param {object} m   { id, nameAr, shortAr, centroid? }
 * @param {object} live { bins, profiles, vehicles, routes, incidents, predictions? }  already filtered to this municipality
 * @param {{remainingShiftHours?:number, now?:number}} [opts]
 */
export function municipalityPressure(m, live, { remainingShiftHours = 4, now = Date.now() } = {}) {
  const { bins = [], profiles = [], vehicles = [], routes = [], incidents = [], predictedSoonIds = new Set() } = live;
  const fill = (b) => Number(b.lastFillLevelPercent);
  const critical = bins.filter((b) => fill(b) >= 85 && fill(b) <= 100).length;
  const warning = bins.filter((b) => fill(b) >= 60 && fill(b) < 85).length;
  const predictedSoon = bins.filter((b) => predictedSoonIds.has(b.id) && fill(b) < 85).length;
  const openIncidents = incidents.filter((i) => i.status === "open").length;
  const activeRoutes = routes.filter((r) => ACTIVE_ROUTE_STATUSES.includes(r.status));
  const busyDrivers = new Set(activeRoutes.map((r) => r.driverId).filter(Boolean));
  const readyDrivers = profiles.filter((p) => p.shiftStatus === "on_shift" && p.availability !== "unavailable" && p.vehicleId && !busyDrivers.has(p.uid));
  const usableVehicles = vehicles.filter((v) => v.status === "available");
  // A crew = a ready driver WITH a usable vehicle; a driver already on a route keeps their vehicle.
  // A driver whose truck is in maintenance is not capacity.
  const crews = Math.min(readyDrivers.length, usableVehicles.length) + activeRoutes.length;
  const demandUnits = critical * PRESSURE_WEIGHTS.critical + warning * PRESSURE_WEIGHTS.warning + predictedSoon * PRESSURE_WEIGHTS.predictedSoon + openIncidents * PRESSURE_WEIGHTS.openIncident;
  const capacityUnits = crews * CREW_BINS_PER_HOUR * remainingShiftHours;
  const ratio = capacityUnits > 0 ? demandUnits / capacityUnits : (demandUnits > 0 ? Infinity : 0);
  const index = capacityUnits > 0 ? Math.min(100, Math.round(ratio * 100)) : (demandUnits > 0 ? 100 : 0);
  const level = index >= 80 ? "critical" : index >= 50 ? "high" : index >= 25 ? "moderate" : "low";
  const reasons = [];
  if (critical) reasons.push(`${critical} حاوية حرجة`);
  if (predictedSoon) reasons.push(`${predictedSoon} متوقع امتلاؤها قريبًا`);
  if (warning) reasons.push(`${warning} تحتاج متابعة`);
  if (openIncidents) reasons.push(`${openIncidents} بلاغ مفتوح`);
  reasons.push(`${readyDrivers.length} سائق جاهز · ${usableVehicles.length} مركبة متاحة · ${activeRoutes.length} جولة نشطة`);
  if (capacityUnits === 0 && demandUnits > 0) reasons.push(readyDrivers.length > 0 && usableVehicles.length === 0 ? "لا طاقة تشغيلية: سائقون جاهزون بلا مركبة صالحة" : "لا طاقة تشغيلية متاحة الآن");
  return { municipalityId: m.id, name: m.shortAr || m.nameAr, index, level, ratio: Number.isFinite(ratio) ? Math.round(ratio * 100) / 100 : null, demandUnits: Math.round(demandUnits * 10) / 10, capacityUnits: Math.round(capacityUnits * 10) / 10,
    critical, warning, predictedSoon, openIncidents, readyDrivers: readyDrivers.length, usableVehicles: usableVehicles.length, activeRoutes: activeRoutes.length, crews, reasons,
    spareDrivers: readyDrivers.filter((p) => !busyDrivers.has(p.uid)), spareVehicles: usableVehicles.filter((v) => !v.driverId || !busyDrivers.has(v.driverId)), remainingShiftHours, at: now };
}

/** Pressure index recomputed with a hypothetical change in ready crews (±n) — used for impact on both sides. */
export function pressureWithCrews(p, deltaCrews) {
  const crews = Math.max(0, p.crews + deltaCrews);
  const capacityUnits = crews * CREW_BINS_PER_HOUR * p.remainingShiftHours;
  const index = capacityUnits > 0 ? Math.min(100, Math.round((p.demandUnits / capacityUnits) * 100)) : (p.demandUnits > 0 ? 100 : 0);
  return { index, level: index >= 80 ? "critical" : index >= 50 ? "high" : index >= 25 ? "moderate" : "low", capacityUnits: Math.round(capacityUnits * 10) / 10 };
}

/**
 * Transfer recommendations for the Amanah.
 * @param {Array} pressures   municipalityPressure() for every municipality
 * @param {object} opts
 * @param {(fromId,toId)=>{distanceKm:number,durationMin:number,source:string}|null} [opts.travel]  real road time between municipalities when known
 * @param {Object<string,{lat,lng}>} [opts.centroids]  fallback Haversine
 * @param {number} [opts.shortageThreshold=50]  pressure index at which a municipality is "short"
 * @param {number} [opts.donorCeiling=40]       a donor's pressure after giving must stay below this
 */
export function recommendTransfers(pressures = [], { travel = null, centroids = {}, shortageThreshold = 50, donorCeiling = 40, maxTransferMin = 45 } = {}) {
  const short = pressures.filter((p) => p.index >= shortageThreshold).sort((a, b) => b.index - a.index);
  const recs = [];
  const warnings = [];
  for (const need of short) {
    const options = [];
    for (const donor of pressures) {
      if (donor.municipalityId === need.municipalityId) continue;
      const vehicle = donor.spareVehicles[0] || null;
      const driver = donor.spareDrivers[0] || null;
      const resourceType = driver && vehicle ? "crew" : vehicle ? "vehicle" : driver ? "driver" : null;
      if (!resourceType) continue;
      const after = { donor: pressureWithCrews(donor, -1), receiver: pressureWithCrews(need, +1) };
      const constraintsViolated = [];
      if (after.donor.index > donorCeiling) constraintsViolated.push(`ضغط ${donor.name} بعد النقل ${after.donor.index} يتجاوز الحد ${donorCeiling}`);
      if (resourceType === "driver" && need.usableVehicles === 0) constraintsViolated.push(`لا مركبة متاحة في ${need.name} لسائق منقول`);
      if (resourceType === "vehicle" && need.spareDrivers.length === 0 && need.readyDrivers === 0) constraintsViolated.push(`لا سائق في ${need.name} لمركبة منقولة`);
      const t = travel ? travel(donor.municipalityId, need.municipalityId) : null;
      const c1 = centroids[donor.municipalityId], c2 = centroids[need.municipalityId];
      const km = t?.distanceKm ?? (c1 && c2 ? Math.round((haversineDistanceKm(c1.lat, c1.lng, c2.lat, c2.lng) ?? 0) * 10) / 10 : null);
      const min = t?.durationMin ?? (km != null ? estimateTravelMinutes(km) : null);
      if (min != null && min > maxTransferMin) constraintsViolated.push(`زمن الانتقال ${min} د يتجاوز ${maxTransferMin} د`);
      const benefit = need.index - after.receiver.index;                 // pressure points relieved at the receiver
      const cost = after.donor.index - donor.index + (min != null ? min / 10 : 5); // donor pressure increase + travel time (10 min ≈ 1 point)
      options.push({ fromMunicipalityId: donor.municipalityId, fromName: donor.name, toMunicipalityId: need.municipalityId, toName: need.name, resourceType,
        resourceId: resourceType === "driver" ? driver?.uid : vehicle?.id, resourceLabel: resourceType === "driver" ? driver?.fullName : vehicle?.vehicleNumber, driverId: driver?.uid || null, driverName: driver?.fullName || null, vehicleId: vehicle?.id || null, vehicleNumber: vehicle?.vehicleNumber || null,
        travelKm: km, travelMin: min, travelSource: t?.source || (km != null ? "haversine" : "none"),
        impact: { receiverBefore: need.index, receiverAfter: after.receiver.index, donorBefore: donor.index, donorAfter: after.donor.index },
        benefit, cost: Math.round(cost * 10) / 10, net: Math.round((benefit - cost) * 10) / 10, feasible: constraintsViolated.length === 0, constraintsViolated });
    }
    const feasible = options.filter((o) => o.feasible).sort((a, b) => b.net - a.net);
    if (feasible.length === 0) { warnings.push(`${need.name}: ضغط ${need.index} ولا يوجد دعم ممكن ضمن القيود${options.length ? ` (${options[0].constraintsViolated[0] || "لا موارد فائضة"})` : " (لا موارد فائضة في البلديات الأخرى)"}`); continue; }
    const best = feasible[0];
    recs.push({ ...best, alternatives: feasible.slice(1, 3), rejected: options.filter((o) => !o.feasible),
      reason: `${need.name} تحت ضغط ${need.level === "critical" ? "حرج" : "مرتفع"} (${need.index}): ${need.reasons.slice(0, 2).join("، ")}. نقل ${best.resourceType === "crew" ? "طاقم" : best.resourceType === "vehicle" ? "مركبة" : "سائق"} ${best.resourceLabel} من ${best.fromName} يخفض ضغطها إلى ${best.impact.receiverAfter} ويرفع ضغط ${best.fromName} من ${best.impact.donorBefore} إلى ${best.impact.donorAfter} فقط · الانتقال ~${best.travelMin ?? "?"} د (${best.travelSource === "osrm" ? "طرق فعلية" : "تقدير"})` });
  }
  return { recommendations: recs, shortages: short.map((p) => ({ municipalityId: p.municipalityId, name: p.name, index: p.index, level: p.level })), warnings, thresholds: { shortageThreshold, donorCeiling, maxTransferMin } };
}

/** City-wide comparison table for the strategic dashboard. */
export function compareMunicipalities(pressures = []) {
  const max = Math.max(1, ...pressures.map((p) => p.index));
  return [...pressures].sort((a, b) => b.index - a.index).map((p, i) => ({ rank: i + 1, ...p, relative: Math.round((p.index / max) * 100) }));
}
