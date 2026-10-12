import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { planDispatch, DEFAULT_TARGETS } from "../autoDispatchEngine";
import { driverOperationalState, shiftWindow, routeRemaining, DRIVER_STATES } from "../driverState";
import { explanationSummary, expectedRouteImpact, referenceOrder, pathKm } from "../decisionExplain";

// 12:00 Buraidah (UTC+3) on a fixed day — shift windows are deterministic.
const now = Date.UTC(2026, 9, 12, 9, 0, 0);
// Sensor freshness is judged against the system clock — pin it to the same instant.
beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now); });
afterAll(() => { vi.useRealTimers(); });
const fresh = new Date(now - 60000).toISOString();
const depot = { lat: 26.33, lng: 43.95 };
const neighborhoods = [{ id: "n1", name: "حي الخليج" }, { id: "n2", name: "حي الشروق" }];
const bin = (id, nid, fill, lat, lng, extra = {}) => ({ id, name: id, neighborhoodId: nid, municipalityId: "east", deviceId: "d" + id, lastFillLevelPercent: fill, lastTemperatureCelsius: 28, lastReadingAt: fresh, lat, lng, capacityLiters: 1100, demo: true, ...extra });
const k = (id, fill, i) => bin(id, "n1", fill, 26.360 + i * 0.001, 43.970 + i * 0.001);
const s = (id, fill, i) => bin(id, "n2", fill, 26.330 + i * 0.001, 44.040 + i * 0.001);
const driver = (uid, extra = {}) => ({ uid, fullName: uid, accountStatus: "active", shiftStatus: "on_shift", availability: "available", vehicleId: "V" + uid, neighborhoodKeys: ["الخليج", "الشروق"], municipalityId: "east", shiftStart: "06:00", shiftEnd: "18:00", ...extra });
const vehicle = (id, extra = {}) => ({ id, vehicleNumber: id, status: "available", capacityLiters: 8000, depotLat: depot.lat, depotLng: depot.lng, municipalityId: "east", ...extra });
const state = (over = {}) => ({ municipalityId: "east", neighborhoods, depot, bins: [], profiles: [], vehicles: [], routes: [], incidents: [], ...over });
const byType = (plan, t) => plan.actions.filter((a) => a.type === t);
const critical = () => [k("k1", 92, 0), k("k2", 90, 1), k("k3", 88, 2)];
// A route in progress in n2 with `pending` stops left.
const inProgress = (pending, extra = {}) => {
  const stops = Array.from({ length: pending }, (_, i) => ({ order: i + 1, binId: `p${i}`, lat: 26.330 + i * 0.001, lng: 44.040 + i * 0.001 }));
  return { id: "RUN", routeName: "جولة الشروق", status: "in_progress", driverId: "D1", driverName: "D1", vehicleId: "VD1", neighborhoodIds: ["n2"], binIds: stops.map((x) => x.binId), orderedStops: stops, collectedBinIds: [], estimatedWasteLiters: 2000, startedAt: fresh, ...extra };
};

describe("shift windows and driver operational state", () => {
  it("shift window in local time, including an overnight shift; unknown when not recorded", () => {
    expect(shiftWindow({ shiftStart: "06:00", shiftEnd: "12:10" }, { now }).minutesLeft).toBe(10);
    expect(shiftWindow({ shiftStart: "22:00", shiftEnd: "06:00" }, { now: Date.UTC(2026, 9, 12, 0, 0) }).minutesLeft).toBe(180); // 03:00 local → ends 06:00
    expect(shiftWindow({}, { now }).known).toBe(false);
  });
  it("states: AVAILABLE, ON_ROUTE, NEXT_ROUTE_RESERVED, OFF_SHIFT, VEHICLE_FULL, VEHICLE_FAULT", () => {
    const v = vehicle("VD1");
    expect(driverOperationalState(driver("D1"), { vehicle: v, routes: [], now }).state).toBe(DRIVER_STATES.AVAILABLE);
    expect(driverOperationalState(driver("D1"), { vehicle: v, routes: [inProgress(2)], now }).state).toBe(DRIVER_STATES.ON_ROUTE);
    const reserved = { id: "NEXT", status: "approved", driverId: "D1", estimatedWasteLiters: 1000, dispatch: { reservedAfterRouteId: "RUN" } };
    expect(driverOperationalState(driver("D1"), { vehicle: v, routes: [inProgress(2), reserved], now }).state).toBe(DRIVER_STATES.NEXT_ROUTE_RESERVED);
    expect(driverOperationalState(driver("D1", { shiftStatus: "off_shift" }), { vehicle: v, now }).state).toBe(DRIVER_STATES.OFF_SHIFT);
    expect(driverOperationalState(driver("D1", { shiftEnd: "11:00" }), { vehicle: v, now }).codes).toContain("SHIFT_ENDED");
    expect(driverOperationalState(driver("D1"), { vehicle: v, routes: [inProgress(2, { estimatedWasteLiters: 7500 })], now }).state).toBe(DRIVER_STATES.VEHICLE_FULL);
    expect(driverOperationalState(driver("D1"), { vehicle: vehicle("VD1", { status: "maintenance" }), now }).state).toBe(DRIVER_STATES.VEHICLE_FAULT);
    expect(driverOperationalState(driver("D1"), { vehicle: v, routes: [inProgress(2)], incidents: [{ routeId: "RUN", status: "open", type: "breakdown" }], now }).state).toBe(DRIVER_STATES.VEHICLE_FAULT);
  });
  it("remaining route time counts only pending stops", () => {
    const r = inProgress(3, { collectedBinIds: ["p0", "p1"] });
    expect(routeRemaining(r).pendingCount).toBe(1);
    expect(routeRemaining(r).remainingMin).toBe(4);
  });
});

describe("decision explainability — every automatic assignment carries a structured record", () => {
  it("records trigger bins, candidates studied, exclusions with codes, vehicle, timing, alternatives, constraints and data sources", () => {
    const profiles = [driver("D1"), driver("OFF", { shiftStatus: "off_shift" }), driver("FAR", { neighborhoodKeys: ["الشروق"] })];
    const plan = planDispatch(state({ bins: critical(), profiles, vehicles: [vehicle("VD1"), vehicle("VOFF"), vehicle("VFAR")] }), {}, { now });
    const a = byType(plan, "create_assign")[0];
    const e = a.explanation;
    expect(e.v).toBe(1);
    expect(e.decisionType).toBe("AUTO_ASSIGNMENT");
    expect(e.trigger.code).toBe("CRITICAL_FILL");
    expect(e.trigger.bins.map((b) => b.binId).sort()).toEqual(["k1", "k2", "k3"]);
    expect(e.trigger.bins[0].source).toBe("simulated");
    expect(e.selection.driverId).toBe("D1");
    expect(e.selection.reasonCodes).toEqual(expect.arrayContaining(["WITHIN_COVERAGE", "SHIFT_AVAILABLE", "SUFFICIENT_CAPACITY", "LOWEST_ELIGIBLE_ESTIMATED_ETA"]));
    expect(e.candidates.evaluated).toBe(3);
    expect(e.candidates.excluded.find((x) => x.driverId === "OFF").codes).toContain("OFF_SHIFT");
    expect(e.candidates.excluded.find((x) => x.driverId === "FAR").codes).toContain("OUTSIDE_COVERAGE");
    expect(e.vehicle.capacityL).toBe(8000);
    expect(e.vehicle.routeWasteL).toBeGreaterThan(0);
    expect(e.timing.etaMin).toBeGreaterThan(0);
    expect(e.timing.completionMin).toBeGreaterThan(e.timing.etaMin);
    expect(new Date(e.timing.expectedCompletionAt).getTime()).toBe(now + e.timing.completionMin * 60000);
    expect(e.alternatives.map((x) => x.option)).toEqual(["INSERT_EXISTING_ROUTE", "RESERVE_NEXT_ROUTE", "NEW_ROUTE_AVAILABLE_DRIVER"]);
    expect(e.alternatives[0].codes).toContain("NO_ACTIVE_ROUTES");
    expect(e.alternatives[2].chosen).toBe(true);
    expect(e.constraints.map((c) => c.code)).toEqual(expect.arrayContaining(["MAX_APPROACH_MIN", "CRITICAL_TARGET_MIN", "MAX_STOPS", "VEHICLE_CAPACITY_L", "SHIFT_MINUTES_LEFT"]));
    expect(e.dataSources).toMatchObject({ fill: "simulated", approach: "estimate" });
    expect(a.route.expectedCollectionMin).toBe(e.timing.completionMin);
    const summary = explanationSummary(e);
    expect(summary).toContain("D1"); expect(summary).toContain("الأقرب زمنيًا"); expect(summary).toContain("تستوعب الحمولة"); expect(summary).toContain("مناوبته تسمح");
  });
  it("no structured record → no invented explanation", () => {
    expect(explanationSummary(null)).toBeNull();
    expect(explanationSummary({ reason: "نص قديم" })).toBeNull();
  });
  it("a repeated cycle on the same state produces the same keys and the same record (deterministic, no duplicate assignment)", () => {
    const st = state({ bins: critical(), profiles: [driver("D1")], vehicles: [vehicle("VD1")] });
    const a = planDispatch(st, {}, { now }), b = planDispatch(st, {}, { now });
    expect(a.actions.map((x) => x.key)).toEqual(b.actions.map((x) => x.key));
    expect(JSON.stringify(byType(a, "create_assign")[0].explanation)).toBe(JSON.stringify(byType(b, "create_assign")[0].explanation));
  });
  it("routing service down → the record says the approach is an estimate because routing failed", () => {
    const plan = planDispatch(state({ bins: critical(), profiles: [driver("D1")], vehicles: [vehicle("VD1")] }), {}, { now, routingStatus: "failed" });
    expect(byType(plan, "create_assign")[0].explanation.dataSources.approach).toBe("estimate_routing_failed");
  });
});

describe("continuous dispatch — a driver on a route is not 'unavailable'", () => {
  const farDepotVehicle = vehicle("VD2", { depotLat: 26.42, depotLng: 44.05 }); // ~12 km from the bins
  it("a driver finishing soon gets the NEXT route reserved when they arrive earlier than an idle but distant driver", () => {
    const plan = planDispatch(state({ bins: critical(), profiles: [driver("D1"), driver("D2")], vehicles: [vehicle("VD1"), farDepotVehicle], routes: [inProgress(1)] }), {}, { now });
    const a = byType(plan, "create_assign")[0];
    expect(a.driverId).toBe("D1");
    expect(a.reservation).toEqual({ afterRouteId: "RUN", startAfterMin: 4 });
    expect(a.route.reservedAfterRouteId).toBe("RUN");
    expect(a.explanation.decisionType).toBe("NEXT_ROUTE_RESERVATION");
    expect(a.explanation.selection.reasonCodes).toContain("NEXT_ROUTE_AFTER_CURRENT");
    expect(a.explanation.alternatives.find((x) => x.option === "RESERVE_NEXT_ROUTE").chosen).toBe(true);
    expect(a.explanation.candidates.excluded.find((x) => x.driverId === "D2").codes).toContain("LATER_ETA");
    expect(explanationSummary(a.explanation)).toContain("حُجزت الجولة التالية");
  });
  it("a driver who will not finish soon is excluded with FINISHES_TOO_LATE; an approved-but-not-started route is never stacked", () => {
    const late = planDispatch(state({ bins: critical(), profiles: [driver("D1"), driver("D2")], vehicles: [vehicle("VD1"), farDepotVehicle], routes: [inProgress(12)] }), {}, { now });
    const a = byType(late, "create_assign")[0];
    expect(a.driverId).toBe("D2");
    expect(a.explanation.candidates.excluded.find((x) => x.driverId === "D1").codes).toContain("FINISHES_TOO_LATE");
    const queued = planDispatch(state({ bins: critical(), profiles: [driver("D1")], vehicles: [vehicle("VD1")], routes: [inProgress(1, { status: "approved" })] }), {}, { now });
    expect(byType(queued, "create_assign").length).toBe(0);
    expect(byType(queued, "escalate")[0].explanation.candidates.excluded[0].codes).toContain("BUSY_ROUTE_NOT_STARTED");
  });
  it("reservation can be switched off by the decision maker", () => {
    const plan = planDispatch(state({ bins: critical(), profiles: [driver("D1")], vehicles: [vehicle("VD1")], routes: [inProgress(1)] }), { allowNextRouteReservation: false }, { now });
    expect(byType(plan, "create_assign").length).toBe(0);
    expect(byType(plan, "escalate")[0].explanation.candidates.excluded[0].codes).toContain("BUSY_ON_ROUTE");
  });
  it("never assigns work that ends after the shift", () => {
    const plan = planDispatch(state({ bins: critical(), profiles: [driver("D1", { shiftEnd: "12:10" })], vehicles: [vehicle("VD1")] }), {}, { now });
    expect(byType(plan, "create_assign").length).toBe(0);
    expect(byType(plan, "escalate")[0].explanation.candidates.excluded[0].codes).toContain("SHIFT_ENDS_BEFORE_COMPLETION");
  });
  it("a faulty vehicle and insufficient capacity are hard exclusions", () => {
    const plan = planDispatch(state({ bins: critical(), profiles: [driver("D1"), driver("D2")], vehicles: [vehicle("VD1", { status: "maintenance" }), vehicle("VD2", { capacityLiters: 1000 })] }), {}, { now });
    expect(byType(plan, "create_assign").length).toBe(0);
    const esc = byType(plan, "escalate")[0];
    expect(esc.explanation.candidates.excluded.find((x) => x.driverId === "D1").codes).toContain("VEHICLE_FAULT");
  });
  it("all drivers busy → escalation records every driver studied and why", () => {
    const routes = [inProgress(12), { ...inProgress(12), id: "RUN2", driverId: "D2", vehicleId: "VD2" }];
    const plan = planDispatch(state({ bins: critical(), profiles: [driver("D1"), driver("D2")], vehicles: [vehicle("VD1"), vehicle("VD2")], routes }), {}, { now });
    const esc = byType(plan, "escalate")[0];
    expect(esc.explanation.decisionType).toBe("ESCALATION");
    expect(esc.explanation.candidates.evaluated).toBe(2);
    expect(esc.explanation.candidates.excluded.every((x) => x.codes.includes("FINISHES_TOO_LATE"))).toBe(true);
    expect(esc.need.binsCount).toBe(3);
  });
});

describe("operational targets drive decisions", () => {
  it("an insertion that would collect a critical bin later than the target is refused; a new route is created instead and records why", () => {
    const route = { ...inProgress(4), neighborhoodIds: ["n1"], orderedStops: Array.from({ length: 4 }, (_, i) => ({ order: i + 1, binId: `q${i}`, lat: 26.360 + i * 0.001, lng: 43.970 + i * 0.001 })), binIds: ["q0", "q1", "q2", "q3"] };
    const bins = [bin("k9", "n1", 95, 26.3635, 43.9735)];
    const loose = planDispatch(state({ bins, profiles: [driver("D1"), driver("D2")], vehicles: [vehicle("VD1"), vehicle("VD2")], routes: [route] }), {}, { now });
    expect(byType(loose, "insert").length).toBe(1);
    const strict = planDispatch(state({ bins, profiles: [driver("D1"), driver("D2")], vehicles: [vehicle("VD1"), vehicle("VD2")], routes: [route] }), { targets: { criticalCollectionMin: 10 } }, { now });
    expect(byType(strict, "insert").length).toBe(0);
    const a = byType(strict, "create_assign")[0];
    expect(a.explanation.alternatives[0].codes).toContain("INSERT_LATER_THAN_TARGET");
  });
  it("a decision that cannot meet the critical target is flagged (and feeds the gap analysis)", () => {
    const plan = planDispatch(state({ bins: critical(), profiles: [driver("D1")], vehicles: [vehicle("VD1")] }), { targets: { criticalCollectionMin: 2 } }, { now });
    const a = byType(plan, "create_assign")[0];
    expect(a.targetMissed).toBe(true);
    expect(a.explanation.constraints.find((c) => c.code === "CRITICAL_TARGET_MIN")).toMatchObject({ limit: 2, met: false });
    expect(DEFAULT_TARGETS.criticalCollectionMin).toBe(60);
  });
});

describe("expected impact of a planned route", () => {
  const stops = [{ binId: "a", lat: 26.36, lng: 43.97, priorityScore: 50 }, { binId: "b", lat: 26.40, lng: 43.99, priorityScore: 90 }, { binId: "c", lat: 26.361, lng: 43.971, priorityScore: 70 }];
  it("compares the optimised order with the urgency-first reference over the SAME bins and start", () => {
    expect(referenceOrder(stops).map((x) => x.binId)).toEqual(["b", "c", "a"]);
    const imp = expectedRouteImpact(depot, stops, { fuelLitersPerKm: 0.35, co2KgPerLiter: 2.68 });
    expect(imp.basis).toBe("expected");
    expect(imp.referenceKm).toBe(pathKm(depot, referenceOrder(stops)));
    expect(imp.kmSaved).toBeCloseTo(Math.max(0, imp.referenceKm - imp.routeKm), 1);
    expect(imp.fuelL).toBeCloseTo(imp.kmSaved * 0.35, 1);
  });
  it("missing fuel factor → fuel and emissions are null (shown as 'غير متاح'), never zero", () => {
    const imp = expectedRouteImpact(depot, stops, { fuelLitersPerKm: null, co2KgPerLiter: 2.68 });
    expect(imp.fuelL).toBeNull(); expect(imp.co2Kg).toBeNull();
  });
});
