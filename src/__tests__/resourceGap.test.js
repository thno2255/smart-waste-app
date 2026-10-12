import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { planDispatch } from "../autoDispatchEngine";
import { analyzeResourceGaps, LADDER } from "../resourceGapEngine";

const now = Date.UTC(2026, 9, 12, 9, 0, 0);
beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now); });
afterAll(() => { vi.useRealTimers(); });
const fresh = new Date(now - 60000).toISOString();
const depot = { lat: 26.33, lng: 43.95 };
const neighborhoods = [{ id: "n1", name: "حي الخليج" }, { id: "n2", name: "حي الشروق" }];
const bin = (id, nid, fill, lat, lng) => ({ id, name: id, neighborhoodId: nid, municipalityId: "east", deviceId: "d" + id, lastFillLevelPercent: fill, lastTemperatureCelsius: 28, lastReadingAt: fresh, lat, lng, capacityLiters: 1100, demo: true });
const k = (id, fill, i) => bin(id, "n1", fill, 26.360 + i * 0.001, 43.970 + i * 0.001);
const driver = (uid, extra = {}) => ({ uid, fullName: uid, accountStatus: "active", shiftStatus: "on_shift", availability: "available", vehicleId: "V" + uid, neighborhoodKeys: ["الخليج", "الشروق"], municipalityId: "east", shiftStart: "06:00", shiftEnd: "18:00", ...extra });
const vehicle = (id, extra = {}) => ({ id, vehicleNumber: id, status: "available", capacityLiters: 8000, depotLat: depot.lat, depotLng: depot.lng, municipalityId: "east", ...extra });
const state = (over = {}) => ({ municipalityId: "east", neighborhoods, depot, bins: [k("k1", 92, 0), k("k2", 90, 1), k("k3", 88, 2)], profiles: [], vehicles: [], routes: [], incidents: [], ...over });
const inProgress = (pending, extra = {}) => {
  const stops = Array.from({ length: pending }, (_, i) => ({ order: i + 1, binId: `p${i}`, lat: 26.330 + i * 0.001, lng: 44.040 + i * 0.001 }));
  return { id: "RUN", routeName: "جولة الشروق", status: "in_progress", driverId: "D1", driverName: "D1", vehicleId: "VD1", neighborhoodIds: ["n2"], binIds: stops.map((x) => x.binId), orderedStops: stops, collectedBinIds: [], estimatedWasteLiters: 2000, startedAt: fresh, ...extra };
};
const run = (st, settings = {}) => { const plan = planDispatch(st, settings, { now }); return { plan, ...analyzeResourceGaps(st, plan, settings, { now }) }; };
const step = (gap, code) => gap.options.find((o) => o.code === code);

describe("resource-gap recommendations — cheapest measure first, computed by re-running the engine", () => {
  it("all drivers busy: the driver finishing a bit later is recommended before adding resources; both are simulated", () => {
    const { gaps } = run(state({ profiles: [driver("D1")], vehicles: [vehicle("VD1")], routes: [inProgress(10)] }));
    expect(gaps.length).toBe(1);
    const g = gaps[0].gap;
    expect(g.options.map((o) => o.code)).toEqual(LADDER.map((l) => l.code));
    expect(g.beforeMin).toBeNull();                                   // no assignment possible now — not shown as 0
    const s3 = step(g, "DRIVER_FINISHING_SOON");
    expect(s3.feasible).toBe(true);
    expect(s3.expected.afterMin).toBeGreaterThan(40);                 // finishes ~40 min + approach
    expect(step(g, "ADD_RESOURCES").feasible).toBe(true);
    expect(step(g, "ADD_RESOURCES").expected.afterMin).toBeLessThan(s3.expected.afterMin);
    // the extra crew meets the target and step 3 does not → the first option that meets the target wins (step 7 here)…
    expect(g.recommendedStep).toBe(step(g, "ADD_RESOURCES").expected.meetsTarget && !s3.expected.meetsTarget ? 7 : 3);
    expect(g.capacity.byState.ON_ROUTE).toBe(1);
    expect(g.demand.binsCount).toBe(3);
  });
  it("…but when an internal measure meets the target, adding resources is NOT recommended", () => {
    const { gaps } = run(state({ profiles: [driver("D1")], vehicles: [vehicle("VD1")], routes: [inProgress(10)] }), { targets: { criticalCollectionMin: 120 } });
    const g = gaps[0].gap;
    expect(step(g, "DRIVER_FINISHING_SOON").expected.meetsTarget).toBe(true);
    expect(g.recommendedStep).toBe(3);
  });
  it("a working driver blocked only by a broken vehicle + an idle vehicle → vehicle redistribution, verified by simulation", () => {
    const { gaps } = run(state({ profiles: [driver("D1")], vehicles: [vehicle("VD1", { status: "maintenance" }), vehicle("VSPARE")] }));
    const g = gaps[0].gap;
    const s5 = step(g, "VEHICLE_REDISTRIBUTION");
    expect(s5.feasible).toBe(true);
    expect(s5.action).toContain("VSPARE");
    expect(g.recommendedStep).toBe(5);
  });
  it("nobody covers the area → only the extra crew (simulated) can serve it; the Amanah referral is listed without invented numbers", () => {
    const { gaps } = run(state({ profiles: [driver("D1", { neighborhoodKeys: ["الشروق"] })], vehicles: [vehicle("VD1")] }));
    const g = gaps[0].gap;
    expect(g.kind).toBe("out_of_scope");
    expect(step(g, "INTER_MUNICIPALITY_SUPPORT").expected).toBeNull();
    expect(step(g, "INTER_MUNICIPALITY_SUPPORT").authority).toBe("الأمانة");
    expect(step(g, "ADD_RESOURCES").feasible).toBe(true);
    expect(g.missingCrews).toBeGreaterThanOrEqual(1);
  });
  it("an assignment that misses the target creates a target-gap recommendation with the measured 'before'", () => {
    const { extraActions } = run(state({ profiles: [driver("D1")], vehicles: [vehicle("VD1")] }), { targets: { criticalCollectionMin: 2 } });
    expect(extraActions.length).toBe(1);
    expect(extraActions[0].kind).toBe("target_gap");
    expect(extraActions[0].gap.beforeMin).toBeGreaterThan(2);
    expect(extraActions[0].key).toMatch(/^esc_target_gap_/);
  });
  it("no alternative at all (no profiles, no depot) → nothing fabricated", () => {
    const { gaps } = run(state({ depot: null, profiles: [], vehicles: [] }));
    const g = gaps[0].gap;
    expect(g.options.filter((o) => o.feasible).length).toBe(0);
    expect(step(g, "ADD_RESOURCES").expected.afterMin).toBeNull();
  });
  it("deterministic: same state → same recommendation", () => {
    const st = state({ profiles: [driver("D1")], vehicles: [vehicle("VD1")], routes: [inProgress(10)] });
    expect(JSON.stringify(run(st).gaps)).toBe(JSON.stringify(run(st).gaps));
  });
});

describe("capacity snapshot reflects this cycle's own assignments", () => {
  it("a driver assigned a route in the same cycle is not counted as spare capacity for another neighbourhood", () => {
    const bins = [k("k1", 92, 0), k("k2", 90, 1), k("k3", 88, 2), bin("s1", "n2", 95, 26.33, 44.04), bin("s2", "n2", 93, 26.331, 44.041), bin("s3", "n2", 91, 26.332, 44.042)];
    const { plan, gaps } = run(state({ bins, profiles: [driver("D1")], vehicles: [vehicle("VD1")] }));
    expect(plan.actions.filter((a) => a.type === "create_assign").length).toBe(1);
    const g = gaps[0].gap;
    expect(g.capacity.byState.AVAILABLE).toBe(0);
    expect(g.capacity.byState.ON_ROUTE).toBe(1);
    expect(g.capacity.availableVehicles).toBe(0);
  });
});
