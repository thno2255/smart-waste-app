import { describe, it, expect } from "vitest";
import { buildCollectionPlan, explainRoute } from "../collectionPlanner";

const now = Date.now();
const fresh = new Date(now - 60000).toISOString();
const depot = { lat: 26.33, lng: 43.95, label: "المستودع" };
const neighborhoods = [{ id: "n1", name: "حي الخليج" }, { id: "n2", name: "حي الشروق" }];
const bin = (id, nid, fill, lat, lng, extra = {}) => ({ id, name: id, neighborhoodId: nid, deviceId: "d" + id, lastFillLevelPercent: fill, lastTemperatureCelsius: 28, lastReadingAt: fresh, lat, lng, capacityLiters: 1100, ...extra });
const bins = [
  bin("k1", "n1", 92, 26.360, 43.970), bin("k2", "n1", 88, 26.361, 43.972), bin("k3", "n1", 30, 26.362, 43.974),
  bin("s1", "n2", 95, 26.330, 44.040), bin("s2", "n2", 40, 26.331, 44.041),
  bin("off", "n2", 97, 26.332, 44.042, { lastReadingAt: new Date(now - 5 * 3600000).toISOString() }), // critical but silent sensor
];
const profiles = [
  { uid: "D1", fullName: "أحمد", accountStatus: "active", shiftStatus: "on_shift", availability: "available", vehicleId: "V1", neighborhoodKeys: ["الخليج", "الشروق"], municipalityId: "east" },
];
const vehicles = [{ id: "V1", vehicleNumber: "مركبة 1", status: "available", capacityLiters: 6000, depotLat: depot.lat, depotLng: depot.lng, municipalityId: "east" }];

describe("buildCollectionPlan", () => {
  it("produces one optimized route per neighborhood with a recommended driver and honest constraints", () => {
    const plan = buildCollectionPlan({ municipalityId: "east", neighborhoods, bins, profiles, vehicles, routes: [], depot, now });
    expect(plan.summary.needCollection).toBe(3);                 // k1, k2, s1 (off is excluded: silent sensor)
    expect(plan.routes.length).toBe(2);
    expect(plan.excluded.map((e) => e.binId)).toEqual(["off"]);
    expect(plan.excluded[0].reason).toContain("غير متصل");
    const withDriver = plan.routes.filter((r) => r.driver);
    expect(withDriver.length).toBe(1);                            // one driver → one route assigned, the other unassigned
    expect(plan.unassigned.length).toBe(1);
    expect(plan.unassigned[0].reasons[0]).not.toContain("لا توجد ملفات سائقين"); // the only driver is busy with the other route, and the reason says so
    expect(plan.summary.unassignedRoutes).toBe(1);
    expect(plan.constraints.some((c) => c.includes("بلا سائق مؤهل"))).toBe(true);
    expect(plan.summary.totalKm).toBeGreaterThan(0);
    expect(plan.summary.confidence).toBe("low");                  // Haversine matrices only
    for (const r of plan.routes) { expect(r.stops.length).toBeGreaterThan(0); expect(["haversine", "osrm"]).toContain(r.matrixSource); }
  });
  it("locks bins already on approved/active routes and says so", () => {
    const routes = [{ id: "R0", status: "approved", binIds: ["k1", "k2"], driverId: "D9" }];
    const plan = buildCollectionPlan({ municipalityId: "east", neighborhoods, bins, profiles, vehicles, routes, depot, now });
    expect(plan.summary.locked).toBe(2);
    expect(plan.routes.map((r) => r.neighborhoodName)).toEqual(["حي الشروق"]);
    expect(plan.constraints.some((c) => c.includes("مرتبطة بجولات"))).toBe(true);
  });
  it("fair baseline: same depot, all bins once; savings only reported when comparable", () => {
    const plan = buildCollectionPlan({ municipalityId: "east", neighborhoods, bins, profiles, vehicles, routes: [], depot, now });
    expect(plan.summary.baselineKm).toBeGreaterThan(plan.summary.planComparableKm);
    expect(plan.summary.reductionPct).toBeGreaterThan(0);
    expect(plan.assumptions.baseline).toContain("نفس المستودع");
    const none = buildCollectionPlan({ municipalityId: "east", neighborhoods, bins: bins.map((b) => ({ ...b, lat: null, lng: null })), profiles, vehicles, routes: [], depot, now });
    expect(none.summary.reductionPct).toBeNull();
  });
  it("uses a supplied OSRM matrix for a neighborhood and raises confidence", () => {
    const nb = bins.filter((b) => b.neighborhoodId === "n1" && b.lastFillLevelPercent >= 85);
    const pts = [depot, ...nb];
    const n = pts.length;
    const durations = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 0 : 5)));
    const distances = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 0 : 2)));
    const plan = buildCollectionPlan({ municipalityId: "east", neighborhoods: [neighborhoods[0]], bins: bins.filter((b) => b.neighborhoodId === "n1"), profiles, vehicles, routes: [], depot, now, matrixByNeighborhood: { n1: { durations, distances, source: "osrm" } } });
    expect(plan.routes[0].matrixSource).toBe("osrm");
    expect(plan.summary.confidence).toBe("high");
    expect(explainRoute(plan.routes[0])).toContain("طرق فعلية");
  });
  it("empty municipality → no routes, no fake savings", () => {
    const plan = buildCollectionPlan({ municipalityId: "west", neighborhoods: [], bins: [], profiles: [], vehicles: [], routes: [], depot, now });
    expect(plan.routes).toEqual([]); expect(plan.summary.confidence).toBe("none"); expect(plan.summary.reductionPct).toBeNull();
  });
});

describe("suggestAdditions (explainable)", () => {
  it("proposes predicted-soon bins that sit near a planned route, with the facts in the sentence", async () => {
    const { suggestAdditions } = await import("../collectionPlanner");
    const plan = buildCollectionPlan({ municipalityId: "east", neighborhoods, bins, profiles, vehicles, routes: [], depot, now });
    const extra = { id: "k9", name: "k9", neighborhoodId: "n1", lat: 26.3605, lng: 43.9705, lastFillLevelPercent: 55 };
    const r = suggestAdditions(plan, [...bins, extra], new Set(["k9", "k3"]));
    expect(r.suggestions.map((s) => s.binId).sort()).toEqual(["k3", "k9"]); // both predicted-soon, both within 1 km of the Khaleej route
    expect(r.suggestions.find((s) => s.binId === "k9").km).toBeLessThan(0.2);
    expect(r.sentences[0]).toContain("يوصى بإضافة"); expect(r.sentences[0]).toContain("k9");
    expect(suggestAdditions(plan, bins, new Set()).suggestions).toEqual([]);
  });
});
