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
import { shiftWindow } from "./driverState";
import { loanWindow, isFree, findReservationConflicts } from "./resourceReservations";

/** Working time a lent resource spends at the receiver (minutes) — a policy default, adjustable per call. */
export const DEFAULT_LOAN_DURATION_MIN = 240;

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
 * Transfer recommendations for the Amanah — consistent as a SET.
 *   • every spare driver / vehicle of every donor is a candidate (not only the first one);
 *   • each candidate holds its resources for a time WINDOW (departure → arrival → task → return);
 *   • shortages are served most-severe first, and a resource already allocated to one shortage — or holding an
 *     overlapping active reservation — is never offered to another (no crew for two municipalities);
 *   • the donor is re-checked with ALL the loans it would give: its pressure after them stays under the ceiling,
 *     it keeps at least one crew while it has critical bins, and the lent driver's shift covers the return.
 * @param {Array} pressures   municipalityPressure() for every municipality
 * @param {object} opts
 * @param {(fromId,toId)=>{distanceKm:number,durationMin:number,source:string}|null} [opts.travel]  real road time between municipalities when known
 * @param {Object<string,{lat,lng}>} [opts.centroids]  fallback Haversine
 * @param {number} [opts.shortageThreshold=50]  pressure index at which a municipality is "short"
 * @param {number} [opts.donorCeiling=40]       a donor's pressure after giving must stay below this
 * @param {number} [opts.loanDurationMin=240]    working time at the receiver (window = 2 × travel + this)
 * @param {Array} [opts.existingReservations]    active resource_reservations {resourceId,startAt,endAt,status}
 */
export function recommendTransfers(pressures = [], { travel = null, centroids = {}, shortageThreshold = 50, donorCeiling = 40, maxTransferMin = 45, loanDurationMin = DEFAULT_LOAN_DURATION_MIN, existingReservations = [], now = Date.now(), tzOffsetMin = 180 } = {}) {
  const short = pressures.filter((p) => p.index >= shortageThreshold).sort((a, b) => b.index - a.index);
  const shortIds = new Set(short.map((p) => p.municipalityId));
  const recs = [];
  const warnings = [];
  const used = new Set();                 // resource ids allocated in THIS recommendation set
  const lentCrews = {};                   // donor municipality → crews already lent in this set
  const travelOf = (fromId, toId) => {
    const tr = travel ? travel(fromId, toId) : null;
    const c1 = centroids[fromId], c2 = centroids[toId];
    const km = tr?.distanceKm ?? (c1 && c2 ? Math.round((haversineDistanceKm(c1.lat, c1.lng, c2.lat, c2.lng) ?? 0) * 10) / 10 : null);
    return { km, min: tr?.durationMin ?? (km != null ? estimateTravelMinutes(km) : null), source: tr?.source || (km != null ? "haversine" : "none") };
  };
  /** Candidate resource bundles a donor can lend: crews (driver + their own or another spare vehicle), lone vehicles, lone drivers. */
  const bundlesOf = (donor) => {
    const out = [];
    const vehicles = donor.spareVehicles || [], drivers = donor.spareDrivers || [];
    for (const d of drivers) {
      const own = vehicles.find((v) => v.id === d.vehicleId);
      const veh = own || vehicles.find((v) => !drivers.some((x) => x.vehicleId === v.id));
      if (veh) out.push({ resourceType: "crew", driver: d, vehicle: veh });
    }
    for (const v of vehicles) out.push({ resourceType: "vehicle", driver: null, vehicle: v });
    for (const d of drivers) out.push({ resourceType: "driver", driver: d, vehicle: null });
    return out;
  };

  for (const need of short) {
    const options = [];
    for (const donor of pressures) {
      if (donor.municipalityId === need.municipalityId || shortIds.has(donor.municipalityId)) continue; // a municipality under pressure never lends
      const tr = travelOf(donor.municipalityId, need.municipalityId);
      const win = loanWindow({ now, travelMin: tr.min ?? 0, taskMin: loanDurationMin });
      for (const b of bundlesOf(donor)) {
        const resourceIds = [b.driver?.uid, b.vehicle?.id].filter(Boolean);
        // Crews the donor loses: a full crew always; a lone vehicle / driver only when it is the binding resource (crews = min(drivers, vehicles)).
        const crewsOut = b.resourceType === "crew" ? 1 : b.resourceType === "vehicle" ? (donor.usableVehicles <= donor.readyDrivers ? 1 : 0) : (donor.readyDrivers <= donor.usableVehicles ? 1 : 0);
        const already = lentCrews[donor.municipalityId] || 0;
        const after = { donor: pressureWithCrews(donor, -(already + crewsOut)), receiver: pressureWithCrews(need, +1) };
        const v = [];
        if (after.donor.index > donorCeiling) v.push(`ضغط ${donor.name} بعد ${already ? "كل الإعارات" : "الإعارة"} ${after.donor.index} يتجاوز الحد ${donorCeiling}`);
        if (donor.critical > 0 && donor.crews - (already + crewsOut) < 1) v.push(`${donor.name} لديها ${donor.critical} حاوية حرجة وستفقد آخر طاقم جاهز`);
        if (b.resourceType === "driver" && need.usableVehicles === 0) v.push(`لا مركبة متاحة في ${need.name} لسائق منقول`);
        if (b.resourceType === "vehicle" && need.spareDrivers.length === 0 && need.readyDrivers === 0) v.push(`لا سائق في ${need.name} لمركبة منقولة`);
        if (tr.min == null) v.push("زمن الانتقال غير قابل للحساب (لا مراكز للبلديات)");
        else if (tr.min > maxTransferMin) v.push(`زمن الانتقال ${tr.min} د يتجاوز ${maxTransferMin} د`);
        if (b.driver) {
          const sw = shiftWindow(b.driver, { now, tzOffsetMin });
          if (sw.known && sw.endAt < new Date(win.endAt).getTime()) v.push(`تنتهي مناوبة ${b.driver.fullName || "السائق"} قبل عودته (${Math.round((new Date(win.endAt).getTime() - sw.endAt) / 60000)} د)`);
        }
        const taken = resourceIds.find((id) => used.has(id));
        if (taken) v.push("المورد مخصص لبلدية أخرى في هذه التوصيات");
        const reserved = resourceIds.find((id) => !isFree(id, win, existingReservations));
        if (reserved) v.push("المورد محجوز في نافذة زمنية متداخلة");
        const benefit = need.index - after.receiver.index;
        const cost = after.donor.index - donor.index + (tr.min != null ? tr.min / 10 : 5);
        options.push({ fromMunicipalityId: donor.municipalityId, fromName: donor.name, toMunicipalityId: need.municipalityId, toName: need.name, resourceType: b.resourceType,
          resourceId: b.resourceType === "driver" ? b.driver.uid : b.vehicle.id, resourceIds, resourceLabel: b.resourceType === "driver" ? b.driver.fullName : b.vehicle.vehicleNumber,
          driverId: b.driver?.uid || null, driverName: b.driver?.fullName || null, vehicleId: b.vehicle?.id || null, vehicleNumber: b.vehicle?.vehicleNumber || null,
          travelKm: tr.km, travelMin: tr.min, travelSource: tr.source, window: win, crewsOut,
          impact: { receiverBefore: need.index, receiverAfter: after.receiver.index, donorBefore: donor.index, donorAfter: after.donor.index },
          benefit, cost: Math.round(cost * 10) / 10, net: Math.round((benefit - cost) * 10) / 10, feasible: v.length === 0, constraintsViolated: v });
      }
    }
    // Prefer a full crew, then net benefit.
    const rank = (o) => (o.resourceType === "crew" ? 2 : 1);
    const feasible = options.filter((o) => o.feasible).sort((a, b) => rank(b) - rank(a) || b.net - a.net);
    if (feasible.length === 0) { warnings.push(`${need.name}: ضغط ${need.index} ولا يوجد دعم ممكن ضمن القيود${options.length ? ` (${options[0].constraintsViolated[0] || "لا موارد فائضة"})` : " (لا موارد فائضة في البلديات الأخرى)"}`); continue; }
    const best = feasible[0];
    best.resourceIds.forEach((id) => used.add(id));
    lentCrews[best.fromMunicipalityId] = (lentCrews[best.fromMunicipalityId] || 0) + best.crewsOut;
    recs.push({ ...best, reservation: { resourceIds: best.resourceIds, startAt: best.window.startAt, endAt: best.window.endAt },
      alternatives: feasible.slice(1).filter((o) => !o.resourceIds.some((id) => used.has(id))).slice(0, 2), rejected: options.filter((o) => !o.feasible).slice(0, 8),
      reason: `${need.name} تحت ضغط ${need.level === "critical" ? "حرج" : "مرتفع"} (${need.index}): ${need.reasons.slice(0, 2).join("، ")}. إعارة ${best.resourceType === "crew" ? "طاقم" : best.resourceType === "vehicle" ? "مركبة" : "سائق"} ${best.resourceLabel} من ${best.fromName} يخفض ضغطها إلى ${best.impact.receiverAfter} ويرفع ضغط ${best.fromName} من ${best.impact.donorBefore} إلى ${best.impact.donorAfter} · الانتقال ~${best.travelMin ?? "?"} د (${best.travelSource === "osrm" ? "طرق فعلية" : "تقدير"}) · مدة الإعارة حتى العودة ${Math.round((new Date(best.window.endAt) - new Date(best.window.startAt)) / 60000)} د` });
  }
  const conflicts = findReservationConflicts(recs.map((r, i) => ({ id: i, ...r.reservation })), existingReservations);
  return { recommendations: recs, shortages: short.map((p) => ({ municipalityId: p.municipalityId, name: p.name, index: p.index, level: p.level })), warnings, conflicts, thresholds: { shortageThreshold, donorCeiling, maxTransferMin, loanDurationMin } };
}

/** City-wide comparison table for the strategic dashboard. */
export function compareMunicipalities(pressures = []) {
  const max = Math.max(1, ...pressures.map((p) => p.index));
  return [...pressures].sort((a, b) => b.index - a.index).map((p, i) => ({ rank: i + 1, ...p, relative: Math.round((p.index / max) * 100) }));
}
