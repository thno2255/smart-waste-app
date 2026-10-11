import { describe, it, expect } from "vitest";
import {
  getBinPriority, polygonCentroid, pointInPolygon, estimateTravelMinutes, orderStopsFrom,
  groupNeighborhoodsByName, findOpenRouteForBin, rankNeighborhoodsForCollection, reconcileRecommendations,
} from "../decisionEngine";

const now = Date.now();
const minutesAgo = (m) => new Date(now - m * 60000).toISOString();

function makeBin(id, neighborhoodId, overrides = {}) {
  return {
    id, neighborhoodId, deviceId: `DEV-${id}`, name: `حاوية ${id}`,
    lastFillLevelPercent: 20, lastTemperatureCelsius: 25, lastReadingAt: minutesAgo(1),
    lat: 26.33, lng: 43.97, capacityLiters: 1100, ...overrides,
  };
}
const score = (bin) => ({ bin, priority: getBinPriority(bin, null, []) });

const square = { type: "Polygon", coordinates: [[[43.90, 26.30], [43.94, 26.30], [43.94, 26.34], [43.90, 26.34], [43.90, 26.30]]] };

describe("geometry helpers", () => {
  it("polygonCentroid of a square is its center", () => {
    const c = polygonCentroid(square);
    expect(c.lat).toBeCloseTo(26.32, 6);
    expect(c.lng).toBeCloseTo(43.92, 6);
  });

  it("pointInPolygon: inside vs outside", () => {
    expect(pointInPolygon(26.32, 43.92, square)).toBe(true);
    expect(pointInPolygon(26.50, 43.92, square)).toBe(false);
    expect(pointInPolygon(26.32, 44.10, square)).toBe(false);
  });

  it("estimateTravelMinutes scales with distance and never returns 0 for a positive distance", () => {
    expect(estimateTravelMinutes(30, 30)).toBe(60);
    expect(estimateTravelMinutes(0.1)).toBe(1);
    expect(estimateTravelMinutes(null)).toBeNull();
  });
});

describe("orderStopsFrom — field route preview from the driver's position", () => {
  it("starts with the stop nearest the driver when priorities are equal, and sums the legs", () => {
    const start = { lat: 26.3000, lng: 43.9000 };
    const near = makeBin("NEAR", "N1", { lastFillLevelPercent: 90, lat: 26.3010, lng: 43.9010 });
    const far = makeBin("FAR", "N1", { lastFillLevelPercent: 90, lat: 26.3300, lng: 43.9500 });
    const r = orderStopsFrom(start, [score(far), score(near)]);
    expect(r.orderedStops.map((s) => s.binId)).toEqual(["NEAR", "FAR"]);
    expect(r.legs.length).toBe(2);
    expect(r.totalDistanceKm).toBeGreaterThan(0);
    expect(r.orderedStops[0].fillLevelPercent).toBe(90);
  });

  it("a much higher-priority bin is still visited first even if slightly farther", () => {
    const start = { lat: 26.3000, lng: 43.9000 };
    const nearLow = makeBin("NEARLOW", "N1", { lastFillLevelPercent: 62, lat: 26.3005, lng: 43.9005 });
    const farCritical = makeBin("FARCRIT", "N1", { lastFillLevelPercent: 97, lat: 26.3030, lng: 43.9030 });
    const r = orderStopsFrom(start, [score(nearLow), score(farCritical)]);
    expect(r.orderedStops[0].binId).toBe("FARCRIT");
  });

  it("without a start point it still orders, with no legs", () => {
    const r = orderStopsFrom(null, [score(makeBin("A", "N1", { lastFillLevelPercent: 90 }))]);
    expect(r.orderedStops.length).toBe(1);
    expect(r.legs).toEqual([]);
    expect(r.totalDistanceKm).toBe(0);
  });
});

describe("groupNeighborhoodsByName — duplicate docs collapse to one polygon", () => {
  it("merges 'حي الإسكان' (demo) and 'حي الإسكان' (legacy) into one group whose primary holds the bins", () => {
    const neighborhoods = [
      { id: "LEGACY", name: "حي الإسكان", demo: false },
      { id: "DEMO", name: "حي الإسكان", demo: true },
      { id: "OTHER", name: "الريان" },
    ];
    const bins = [makeBin("B1", "DEMO"), makeBin("B2", "DEMO")];
    const groups = groupNeighborhoodsByName(neighborhoods, bins);
    expect(groups.length).toBe(2);
    const iskan = groups.find((g) => g.key === "الإسكان");
    expect(iskan.ids.sort()).toEqual(["DEMO", "LEGACY"]);
    expect(iskan.primary.id).toBe("DEMO");
  });
});

describe("rankNeighborhoodsForCollection — 'needs collection now'", () => {
  const neighborhoods = [
    { id: "N1", name: "حي الإسكان" }, { id: "N1b", name: "الإسكان" },
    { id: "N2", name: "حي الريان" }, { id: "N3", name: "حي النقع" },
  ];
  const bins = [
    makeBin("C1", "N1", { lastFillLevelPercent: 95, lat: 26.38, lng: 43.93 }),
    makeBin("C2", "N1b", { lastFillLevelPercent: 90, lat: 26.38, lng: 43.93 }), // duplicate doc of the same neighborhood
    makeBin("OK", "N2", { lastFillLevelPercent: 15 }),
    makeBin("H1", "N3", { lastFillLevelPercent: 78, lat: 26.35, lng: 44.00 }),
  ];
  const scored = bins.map(score);
  const groups = groupNeighborhoodsByName(neighborhoods, bins);

  it("excludes neighborhoods with no eligible bins and orders critical first; duplicates sum their bins", () => {
    const ranked = rankNeighborhoodsForCollection(groups, scored, []);
    expect(ranked.map((r) => r.group.key)).toEqual(["الإسكان", "النقع"]);
    expect(ranked[0].criticalCount).toBe(2);
    expect(ranked[0].eligibleBins.length).toBe(2);
  });

  it("reports distance/ETA from the driver and the open route for the neighborhood", () => {
    const routes = [{ id: "R1", status: "suggested", neighborhoodIds: ["N3"], binIds: ["H1"] }];
    const ranked = rankNeighborhoodsForCollection(groups, scored, routes, {
      from: { lat: 26.33, lng: 43.97 },
      centroidFor: (g) => (g.key === "النقع" ? { lat: 26.35, lng: 44.0 } : { lat: 26.38, lng: 43.93 }),
    });
    const naqaa = ranked.find((r) => r.group.key === "النقع");
    expect(naqaa.openRoute.id).toBe("R1");
    expect(naqaa.distanceKm).toBeGreaterThan(0);
    expect(naqaa.etaMinutes).toBeGreaterThan(0);
    expect(findOpenRouteForBin("H1", routes).id).toBe("R1");
    expect(findOpenRouteForBin("C1", routes)).toBeNull();
  });
});

describe("reconcileRecommendations — bins ↔ routes stay linked", () => {
  const neighborhoods = [{ id: "N1", name: "حي الإسكان" }, { id: "N2", name: "حي النقع" }];

  it("creates a suggestion for a new critical neighborhood", () => {
    const scored = [score(makeBin("C1", "N1", { lastFillLevelPercent: 95 }))];
    const r = reconcileRecommendations(neighborhoods, scored, []);
    expect(r.toCreate.length).toBe(1);
    expect(r.toCreate[0].status).toBe("suggested");
    expect(r.toUpdate).toEqual([]);
    expect(r.toWithdraw).toEqual([]);
  });

  it("refreshes an existing suggestion in place when a new bin becomes critical instead of duplicating it", () => {
    const scored = [score(makeBin("C1", "N1", { lastFillLevelPercent: 95 })), score(makeBin("C2", "N1", { lastFillLevelPercent: 91 }))];
    const open = [{ id: "R1", status: "suggested", neighborhoodIds: ["N1"], binIds: ["C1"] }];
    const r = reconcileRecommendations(neighborhoods, scored, open);
    expect(r.toCreate).toEqual([]);
    expect(r.toUpdate.length).toBe(1);
    expect(r.toUpdate[0].id).toBe("R1");
    expect(r.toUpdate[0].data.binIds.sort()).toEqual(["C1", "C2"]);
  });

  it("leaves an unchanged suggestion alone", () => {
    const scored = [score(makeBin("C1", "N1", { lastFillLevelPercent: 95 }))];
    const open = [{ id: "R1", status: "suggested", neighborhoodIds: ["N1"], binIds: ["C1"] }];
    const r = reconcileRecommendations(neighborhoods, scored, open);
    expect(r.unchanged).toEqual(["R1"]);
    expect(r.toUpdate).toEqual([]);
  });

  it("never touches an approved route, and does not re-suggest bins it already holds", () => {
    const scored = [score(makeBin("C1", "N1", { lastFillLevelPercent: 95 })), score(makeBin("C2", "N1", { lastFillLevelPercent: 91 }))];
    const open = [{ id: "R1", status: "approved", neighborhoodIds: ["N1"], binIds: ["C1"] }];
    const r = reconcileRecommendations(neighborhoods, scored, open);
    expect(r.toUpdate).toEqual([]);
    expect(r.toWithdraw).toEqual([]);
    expect(r.toCreate.length).toBe(1);
    expect(r.toCreate[0].binIds).toEqual(["C2"]); // only the bin NOT already in the human-approved route
  });

  it("withdraws a suggestion whose bins no longer qualify (bin was emptied)", () => {
    const scored = [score(makeBin("C1", "N1", { lastFillLevelPercent: 10 }))];
    const open = [{ id: "R1", status: "suggested", neighborhoodIds: ["N1"], binIds: ["C1"] }];
    const r = reconcileRecommendations(neighborhoods, scored, open);
    expect(r.toWithdraw).toEqual(["R1"]);
  });

  it("keeps a manually-added bin in the refreshed suggestion and never withdraws a route with manual bins", () => {
    const scored = [score(makeBin("C1", "N1", { lastFillLevelPercent: 95 })), score(makeBin("M1", "N1", { lastFillLevelPercent: 20 }))];
    const open = [{ id: "R1", status: "suggested", neighborhoodIds: ["N1"], binIds: ["M1"], manualBinIds: ["M1"] }];
    const r = reconcileRecommendations(neighborhoods, scored, open);
    expect(r.toUpdate.length).toBe(1);
    expect(r.toUpdate[0].data.binIds).toEqual(["C1", "M1"]);
    expect(r.toUpdate[0].data.orderedStops.find((s) => s.binId === "M1").manual).toBe(true);

    const emptied = reconcileRecommendations(neighborhoods, [score(makeBin("M1", "N1", { lastFillLevelPercent: 20 }))], open);
    expect(emptied.toWithdraw).toEqual([]);
  });
});
