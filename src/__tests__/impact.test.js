import { describe, it, expect } from "vitest";
import { getBinPriority, groupNeighborhoodsByName } from "../decisionEngine";
import { computeImpactMetrics, computeFleetPerformance, ASSUMPTIONS } from "../impact";

const now = Date.now();
const minutesAgo = (m) => new Date(now - m * 60000).toISOString();
const bin = (id, nid, fill, lat, lng) => ({ id, neighborhoodId: nid, deviceId: `D-${id}`, name: id, lastFillLevelPercent: fill, lastTemperatureCelsius: 25, lastReadingAt: minutesAgo(1), lat, lng, capacityLiters: 1100 });
const score = (b) => ({ bin: b, priority: getBinPriority(b, null, []) });

describe("computeImpactMetrics — fixed schedule vs data-driven", () => {
  const neighborhoods = [{ id: "N1", name: "حي الإسكان" }, { id: "N2", name: "حي الريان" }];
  const bins = [
    bin("A", "N1", 95, 26.380, 43.930), bin("B", "N1", 15, 26.381, 43.931), bin("C", "N1", 20, 26.382, 43.932),
    bin("D", "N2", 10, 26.400, 43.910), bin("E", "N2", 12, 26.401, 43.911),
  ];
  const scored = bins.map(score);
  const groups = groupNeighborhoodsByName(neighborhoods, bins);
  const depot = { lat: 26.334, lng: 43.972 };

  it("counts every bin in the baseline and only eligible bins in the data-driven plan", () => {
    const m = computeImpactMetrics(groups, scored, [], { depot });
    expect(m.baselineStops).toBe(5);
    expect(m.dataDrivenStops).toBe(1);
    expect(m.stopsAvoided).toBe(4);
    expect(m.neighborhoodsSkipped).toBe(1); // الريان has nothing eligible → no trip at all
    expect(m.kmSaved).toBeGreaterThan(0);
    expect(m.baselineKm).toBeGreaterThanOrEqual(m.dataDrivenKm);
  });

  it("derives fuel and CO2 from the stated assumptions, not magic numbers", () => {
    const m = computeImpactMetrics(groups, scored, [], { depot });
    expect(m.fuelSavedL).toBeCloseTo(Math.round(m.kmSaved * ASSUMPTIONS.truckFuelLitersPerKm * 10) / 10, 0);
    expect(m.co2SavedKg).toBeGreaterThan(0);
    expect(m.assumptions).toBe(ASSUMPTIONS);
  });

  it("counts a critical bin as an overflow prevented only once a route covers it", () => {
    expect(computeImpactMetrics(groups, scored, [], { depot }).overflowsPrevented).toBe(0);
    const routes = [{ id: "R1", status: "suggested", binIds: ["A"] }];
    expect(computeImpactMetrics(groups, scored, routes, { depot }).overflowsPrevented).toBe(1);
  });

  it("handles no bins without dividing by zero", () => {
    const m = computeImpactMetrics([], [], []);
    expect(m.reductionPct).toBe(0);
    expect(m.kmSaved).toBe(0);
  });
});

describe("computeFleetPerformance", () => {
  const vehicles = [{ id: "V1", vehicleNumber: "مركبة 1", status: "available" }, { id: "V2", vehicleNumber: "مركبة 2", status: "maintenance" }];
  const routes = [
    { id: "R1", routeName: "ج1", status: "completed", vehicleId: "V1", driverId: "U1", binIds: ["A", "B", "C"], estimatedDistanceKm: 6, approvedAt: minutesAgo(200), startedAt: minutesAgo(120), completedAt: minutesAgo(90) },
    { id: "R2", routeName: "ج2", status: "completed", vehicleId: "V1", driverId: "U1", binIds: ["D", "E"], estimatedDistanceKm: 3, startedAt: minutesAgo(60), completedAt: minutesAgo(10) },
    { id: "R3", routeName: "ج3", status: "suggested", vehicleId: null, binIds: ["F"] },
  ];
  const events = [
    { routeId: "R1", binId: "A", fillBefore: 92 }, { routeId: "R1", binId: "B", fillBefore: 88 },
    { routeId: "R2", binId: "D", fillBefore: 80 }, { routeId: "R2", binId: "E", fillBefore: 78 },
  ];
  const audit = [
    { action: "route_stop_skipped", details: { routeId: "R1", binId: "C" } },
    { action: "route_obstacle_reported", details: { routeId: "R2" } },
  ];

  it("only completed routes count; collected/skipped/incidents and timing are attributed per route", () => {
    const perf = computeFleetPerformance(routes, events, audit, vehicles);
    expect(perf.perRoute.length).toBe(2);
    const r1 = perf.perRoute.find((r) => r.routeId === "R1");
    expect(r1.collected).toBe(2);
    expect(r1.skipped).toBe(1);
    expect(r1.completionPct).toBe(67);
    expect(r1.avgFillAtCollection).toBe(90);
    expect(r1.actualMin).toBe(30);
    expect(r1.approvalToStartMin).toBe(80);
    const r2 = perf.perRoute.find((r) => r.routeId === "R2");
    expect(r2.incidents).toBe(1);
    expect(r2.onTime).toBe(false); // 50 actual vs ~14 planned
  });

  it("rolls up per vehicle and per driver, keeping vehicles with no routes", () => {
    const perf = computeFleetPerformance(routes, events, audit, vehicles);
    const v1 = perf.vehicles.find((v) => v.id === "V1");
    expect(v1.routes).toBe(2);
    expect(v1.collected).toBe(4);
    expect(v1.km).toBe(9);
    const v2 = perf.vehicles.find((v) => v.id === "V2");
    expect(v2.routes).toBe(0);
    expect(v2.onTimePct).toBeNull();
    expect(perf.drivers.find((d) => d.id === "U1").routes).toBe(2);
    expect(perf.totals.collected).toBe(4);
  });
});
