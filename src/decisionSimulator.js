/**
 * decisionSimulator.js — Phase 6: Decision Simulation Center ("what if").
 * ─────────────────────────────────────────────────────────────────────
 * Takes an ISOLATED COPY of the operational state (bins, drivers, vehicles,
 * routes) for one or more municipalities, applies a scenario mutation, re-runs
 * the real planning engine (collectionPlanner) and the pressure model, and
 * compares against the untouched baseline. Pure: nothing here writes to the
 * live data; the UI persists the result as a simulation_scenarios record.
 *
 * Scenarios: vehicle_down, driver_absent, waste_rate_up, more_critical,
 *            transfer_vehicle, transfer_driver, road_closed, route_delayed, vehicles_count
 * Metrics:   served / unserved bins, response time (approach), distance, operating
 *            minutes, vehicle utilization, estimated cost, pressure index.
 * ─────────────────────────────────────────────────────────────────────
 */
import { buildCollectionPlan } from "./collectionPlanner";
import { municipalityPressure } from "./interMunicipalEngine";
import { ASSUMPTIONS } from "./impact";

export const SCENARIO_TYPES = {
  vehicle_down:     { label: "تعطل مركبة",                     params: ["vehicleId"] },
  driver_absent:    { label: "غياب سائق",                       params: ["driverId"] },
  waste_rate_up:    { label: "ارتفاع معدل توليد النفايات",     params: ["factor"] },
  more_critical:    { label: "زيادة الحاويات الحرجة",           params: ["count"] },
  transfer_vehicle: { label: "نقل مركبة من بلدية أخرى",         params: ["vehicleId", "fromMunicipalityId"] },
  transfer_driver:  { label: "نقل سائق مؤقتًا",                  params: ["driverId", "fromMunicipalityId"] },
  road_closed:      { label: "إغلاق طريق (تأخير وصول)",         params: ["delayMin"] },
  route_delayed:    { label: "تأخر جولة (سائق مشغول أطول)",     params: ["routeId", "delayMin"] },
  vehicles_count:   { label: "تغير عدد المركبات المتاحة",       params: ["delta"] },
};

const clone = (x) => JSON.parse(JSON.stringify(x));

/** Apply one scenario to a deep copy of the state. Returns { state, notes[] }. */
export function applyScenario(state, scenario) {
  const s = clone(state);
  const notes = [];
  const t = scenario.type;
  switch (t) {
    case "vehicle_down": { const v = s.vehicles.find((x) => x.id === scenario.vehicleId); if (!v) notes.push("المركبة غير موجودة"); else { v.status = "maintenance"; notes.push(`${v.vehicleNumber} خارج الخدمة`); } break; }
    case "driver_absent": { const p = s.profiles.find((x) => x.uid === scenario.driverId); if (!p) notes.push("السائق غير موجود"); else { p.shiftStatus = "off_shift"; p.availability = "unavailable"; notes.push(`${p.fullName} غائب`); } break; }
    case "waste_rate_up": { const f = Number(scenario.factor) || 1.5; for (const b of s.bins) { if (b.lastFillLevelPercent != null && b.lastFillLevelPercent <= 100) b.lastFillLevelPercent = Math.min(100, Math.round(b.lastFillLevelPercent * f)); if (b.fillRatePerHour) b.fillRatePerHour = Math.round(b.fillRatePerHour * f * 100) / 100; } notes.push(`الامتلاء × ${f}`); break; }
    case "more_critical": { const n = Math.max(0, Number(scenario.count) || 3); const pool = s.bins.filter((b) => b.lastFillLevelPercent != null && b.lastFillLevelPercent < 85 && b.lastFillLevelPercent <= 100).sort((a, b) => b.lastFillLevelPercent - a.lastFillLevelPercent); pool.slice(0, n).forEach((b) => { b.lastFillLevelPercent = 90; }); notes.push(`${Math.min(n, pool.length)} حاوية إضافية حرجة`); break; }
    case "transfer_vehicle": { const v = s.extraVehicles?.find((x) => x.id === scenario.vehicleId); if (!v) notes.push("المركبة المنقولة غير متاحة في البلدية المرسِلة"); else { s.vehicles.push({ ...v, municipalityId: s.municipalityId, transferred: true }); if (scenario.withDriver && scenario.driver) s.profiles.push({ ...scenario.driver, municipalityId: s.municipalityId, vehicleId: v.id, neighborhoodKeys: s.neighborhoods.map((n) => n.key || n.name.replace(/^حي\s+/, "")), transferred: true }); notes.push(`+ ${v.vehicleNumber}${scenario.withDriver ? " مع سائق" : ""} من ${scenario.fromMunicipalityId}`); } break; }
    case "transfer_driver": { const p = s.extraProfiles?.find((x) => x.uid === scenario.driverId); if (!p) notes.push("السائق المنقول غير متاح"); else { const freeV = s.vehicles.find((v) => v.status === "available" && !s.profiles.some((q) => q.vehicleId === v.id)); s.profiles.push({ ...p, municipalityId: s.municipalityId, vehicleId: freeV?.id || null, neighborhoodKeys: s.neighborhoods.map((n) => n.key || n.name.replace(/^حي\s+/, "")), shiftStatus: "on_shift", availability: "available", transferred: true }); notes.push(`+ ${p.fullName}${freeV ? ` على ${freeV.vehicleNumber}` : " (لا مركبة حرة — بلا أثر)"}`); } break; }
    case "road_closed": { s.roadDelayMin = Number(scenario.delayMin) || 15; notes.push(`+${s.roadDelayMin} د على كل وصول (طريق مغلق)`); break; }
    case "route_delayed": { const r = s.routes.find((x) => x.id === scenario.routeId); if (!r) notes.push("الجولة غير موجودة"); else { r.status = "in_progress"; r.delayedMin = Number(scenario.delayMin) || 60; notes.push(`${r.routeName} متأخرة ${r.delayedMin} د — سائقها مشغول`); } break; }
    case "vehicles_count": { const d = Number(scenario.delta) || 0; if (d < 0) { s.vehicles.filter((v) => v.status === "available").slice(0, -d).forEach((v) => { v.status = "offline"; }); } else { for (let i = 0; i < d; i++) s.vehicles.push({ id: `sim-v${i}`, vehicleNumber: `مركبة افتراضية ${i + 1}`, status: "available", capacityLiters: 6000, municipalityId: s.municipalityId }); } notes.push(`${d >= 0 ? "+" : ""}${d} مركبة`); break; }
    default: notes.push("سيناريو غير معروف");
  }
  return { state: s, notes };
}

/** Metrics of a plan + pressure for one municipality state. */
export function evaluateState(state, { depot, now = Date.now() }) {
  const plan = buildCollectionPlan({ municipalityId: state.municipalityId, neighborhoods: state.neighborhoods, bins: state.bins, profiles: state.profiles, vehicles: state.vehicles, routes: state.routes, depot, now });
  const delay = state.roadDelayMin || 0;
  const assigned = plan.routes.filter((r) => r.driver);
  const responseMins = assigned.map((r) => (r.driver.approachMin ?? 0) + delay);
  const served = assigned.reduce((a, r) => a + r.stops.length, 0);
  const unserved = plan.summary.needCollection - served;
  const km = assigned.reduce((a, r) => a + (r.distanceKm || 0), 0);
  const minutes = assigned.reduce((a, r) => a + (r.durationMin || 0) + delay, 0);
  const usable = state.vehicles.filter((v) => v.status === "available").length;
  const utilization = usable ? Math.round((assigned.length / usable) * 100) : null;
  const cost = Math.round(km * ASSUMPTIONS.truckFuelLitersPerKm * ASSUMPTIONS.fuelPricePerLiter + (minutes / 60) * ASSUMPTIONS.crewCostPerHour);
  const pressure = municipalityPressure({ id: state.municipalityId, shortAr: state.municipalityName }, { bins: state.bins, profiles: state.profiles, vehicles: state.vehicles, routes: state.routes, incidents: state.incidents || [] }, { now });
  return { served, unserved, routes: plan.routes.length, unassignedRoutes: plan.unassigned.length, avgResponseMin: responseMins.length ? Math.round(responseMins.reduce((a, b) => a + b, 0) / responseMins.length) : null, km: Math.round(km * 10) / 10, minutes: Math.round(minutes), utilization, cost, pressure: pressure.index, pressureLevel: pressure.level, constraints: plan.constraints, plan };
}

/**
 * Run a scenario against an isolated copy and compare with the baseline.
 * @param {object} state  { municipalityId, municipalityName, neighborhoods, bins, profiles, vehicles, routes, incidents, extraVehicles?, extraProfiles? }
 */
export function simulateDecision(state, scenario, { depot, now = Date.now() } = {}) {
  const baseline = evaluateState(clone(state), { depot, now });
  const { state: mutated, notes } = applyScenario(state, scenario);
  const result = evaluateState(mutated, { depot, now });
  const delta = {};
  for (const k of ["served", "unserved", "routes", "unassignedRoutes", "avgResponseMin", "km", "minutes", "utilization", "cost", "pressure"]) delta[k] = result[k] != null && baseline[k] != null ? Math.round((result[k] - baseline[k]) * 10) / 10 : null;
  const better = delta.unserved != null && delta.unserved < 0 || (delta.unserved === 0 && delta.pressure != null && delta.pressure < 0);
  const worse = delta.unserved != null && delta.unserved > 0 || (delta.unserved === 0 && delta.pressure != null && delta.pressure > 0);
  const recommendation = better ? "يُوصى بالقرار: يخدم حاويات أكثر أو يخفض الضغط دون تجاوز القيود"
    : worse ? `لا يُوصى: ${delta.unserved > 0 ? `${delta.unserved} حاوية إضافية بلا خدمة` : `الضغط يرتفع ${delta.pressure} نقطة`}${result.unassignedRoutes ? ` و${result.unassignedRoutes} جولة بلا سائق` : ""}`
    : "أثر محايد على الخدمة؛ قارن المسافة والتكلفة قبل الاعتماد";
  const explanation = [`السيناريو: ${SCENARIO_TYPES[scenario.type]?.label || scenario.type} — ${notes.join("، ")}`,
    `الحاويات المخدومة ${baseline.served} ← ${result.served} · غير المخدومة ${baseline.unserved} ← ${result.unserved} · الضغط ${baseline.pressure} ← ${result.pressure}`,
    `المسافة ${baseline.km} ← ${result.km} كم · زمن التشغيل ${baseline.minutes} ← ${result.minutes} د · الاستجابة ${baseline.avgResponseMin ?? "—"} ← ${result.avgResponseMin ?? "—"} د · تكلفة تقديرية ${baseline.cost} ← ${result.cost} ريال`,
    ...(result.constraints.length ? [`قيود: ${result.constraints.join(" · ")}`] : [])];
  const strip = (e) => { const { plan, ...rest } = e; return rest; }; // eslint-disable-line no-unused-vars
  return { scenario, notes, baseline: strip(baseline), result: strip(result), delta, verdict: better ? "better" : worse ? "worse" : "neutral", recommendation, explanation, assumptions: { fuelPricePerLiter: ASSUMPTIONS.fuelPricePerLiter, crewCostPerHour: ASSUMPTIONS.crewCostPerHour, truckFuelLitersPerKm: ASSUMPTIONS.truckFuelLitersPerKm, note: "التكلفة تقديرية من افتراضات معلنة؛ المسافات بالمسافة الجوية ما لم تُمرَّر مصفوفة طرق" } };
}
