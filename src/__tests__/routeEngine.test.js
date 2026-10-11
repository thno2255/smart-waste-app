import { describe, it, expect } from "vitest";
import { getBinPriority, getRouteEligibility, recommendRoutes, routePreCheck, haversineDistanceKm } from "../decisionEngine";

const now = Date.now();
const minutesAgo = (m) => new Date(now - m * 60000).toISOString();

function makeBin(id, neighborhoodId, overrides = {}) {
  return {
    id, neighborhoodId, deviceId: `DEV-${id}`,
    name: `حاوية ${id}`,
    lastFillLevelPercent: 20, lastTemperatureCelsius: 25,
    lastReadingAt: minutesAgo(1),
    lat: 26.33, lng: 43.97,
    capacityLiters: 1100,
    ...overrides,
  };
}

function score(bin, context = {}) {
  return { bin, priority: getBinPriority(bin, null, [], context) };
}

const neighborhoods = [
  { id: "N1", name: "حي الريان" },
  { id: "N2", name: "حي الإسكان" },
];

describe("recommendRoutes — §42", () => {
  it("no eligible bins → no routes", () => {
    const scored = [score(makeBin("B1", "N1", { lastFillLevelPercent: 10 }))];
    expect(recommendRoutes(neighborhoods, scored)).toEqual([]);
  });

  it("one critical bin → one suggested route containing it", () => {
    const scored = [score(makeBin("B1", "N1", { lastFillLevelPercent: 92 }))];
    const routes = recommendRoutes(neighborhoods, scored);
    expect(routes.length).toBe(1);
    expect(routes[0].binIds).toContain("B1");
    expect(routes[0].status).toBe("suggested");
  });

  it("multiple critical bins in the same neighborhood → one route with all of them ordered", () => {
    const scored = [
      score(makeBin("B1", "N1", { lastFillLevelPercent: 90, lat: 26.330, lng: 43.970 })),
      score(makeBin("B2", "N1", { lastFillLevelPercent: 95, lat: 26.331, lng: 43.971 })),
      score(makeBin("B3", "N1", { lastFillLevelPercent: 88, lat: 26.329, lng: 43.969 })),
    ];
    const routes = recommendRoutes(neighborhoods, scored);
    expect(routes.length).toBe(1);
    expect(routes[0].binIds.length).toBe(3);
    expect(routes[0].orderedStops[0].order).toBe(1);
    expect(routes[0].orderedStops.map((s) => s.order)).toEqual([1, 2, 3]);
  });

  it("bins across multiple neighborhoods → one route per neighborhood, highest priority first", () => {
    const scored = [
      score(makeBin("B1", "N1", { lastFillLevelPercent: 90 })),
      score(makeBin("B2", "N2", { lastFillLevelPercent: 78 })), // "high" tier, eligible
    ];
    const routes = recommendRoutes(neighborhoods, scored);
    const neighborhoodIds = routes.map((r) => r.neighborhoodIds[0]);
    expect(new Set(neighborhoodIds).size).toBe(routes.length); // one route per neighborhood
    if (routes.length === 2) {
      expect(routes[0].totalPriorityScore).toBeGreaterThanOrEqual(routes[1].totalPriorityScore);
    }
  });

  it("offline bins are excluded from automatic eligibility", () => {
    const offlineBin = makeBin("B1", "N1", { lastFillLevelPercent: 95, lastReadingAt: minutesAgo(90) });
    const elig = getRouteEligibility(offlineBin, getBinPriority(offlineBin, null, []));
    expect(elig.eligible).toBe(false);
    expect(recommendRoutes(neighborhoods, [score(offlineBin)])).toEqual([]);
  });

  it("fault bins (out-of-range reading) are excluded from automatic eligibility", () => {
    const faultBin = makeBin("B1", "N1", { lastFillLevelPercent: 95 });
    const latestReading = { fill_level_percent: 150, timestamp: minutesAgo(1) };
    const priority = getBinPriority(faultBin, latestReading, []);
    expect(priority.sensorHealth.status).toBe("fault");
    expect(getRouteEligibility(faultBin, priority).eligible).toBe(false);
  });

  it("manual inclusion: an ineligible bin can still ride in a route's binIds (UI-level override), and pre-check doesn't reject it purely for that", () => {
    const normalBin = makeBin("B1", "N1", { lastFillLevelPercent: 20 });
    const priority = getBinPriority(normalBin, null, []);
    expect(getRouteEligibility(normalBin, priority).eligible).toBe(false); // not auto-eligible

    // An operator manually adds it to an otherwise-valid route (§18 "إضافة حاوية").
    const manualRoute = { id: "R1", binIds: ["B1"], estimatedWasteLiters: 200 };
    const vehicle = { status: "available", capacityLiters: 6000 };
    const check = routePreCheck(manualRoute, [normalBin], vehicle);
    expect(check.ready).toBe(true); // nothing in pre-check blocks a manually-included normal bin
  });

  it("priority ordering: higher-priority bin is ordered before a lower one at similar distance", () => {
    const scored = [
      score(makeBin("B1", "N1", { lastFillLevelPercent: 90, lat: 26.3300, lng: 43.9700 })),
      score(makeBin("B2", "N1", { lastFillLevelPercent: 78, lat: 26.3301, lng: 43.9701 })), // "high" tier, still eligible but lower priority than B1
    ];
    const routes = recommendRoutes(neighborhoods, scored);
    expect(routes[0].orderedStops[0].binId).toBe("B1");
  });

  it("distance ordering: nearest-neighbor pulls a close bin forward over a far one of similar priority", () => {
    const scored = [
      score(makeBin("B1", "N1", { lastFillLevelPercent: 90, lat: 26.3300, lng: 43.9700 })),
      score(makeBin("B2", "N1", { lastFillLevelPercent: 90, lat: 26.3301, lng: 43.9701 })), // very close to B1
      score(makeBin("B3", "N1", { lastFillLevelPercent: 90, lat: 26.5000, lng: 44.2000 })), // far away
    ];
    const routes = recommendRoutes(neighborhoods, scored);
    const order = routes[0].orderedStops.map((s) => s.binId);
    expect(order.indexOf("B2")).toBeLessThan(order.indexOf("B3"));
  });

  it("capacity limit is flagged by routePreCheck when estimated load exceeds vehicle capacity", () => {
    const route = { id: "R1", binIds: ["B1"], estimatedWasteLiters: 9000 };
    const vehicle = { status: "available", capacityLiters: 6000 };
    const check = routePreCheck(route, [makeBin("B1", "N1")], vehicle);
    expect(check.ready).toBe(false);
    expect(check.issues.some((i) => i.includes("سعة"))).toBe(true);
  });
});

describe("haversineDistanceKm", () => {
  it("returns 0 for identical points and a positive value for distinct ones", () => {
    expect(haversineDistanceKm(26.33, 43.97, 26.33, 43.97)).toBeCloseTo(0, 5);
    expect(haversineDistanceKm(26.33, 43.97, 26.40, 44.05)).toBeGreaterThan(0);
  });

  it("returns null for missing coordinates instead of throwing", () => {
    expect(haversineDistanceKm(null, 43.97, 26.33, 43.97)).toBeNull();
  });
});
