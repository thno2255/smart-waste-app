import { describe, it, expect } from "vitest";
import { operationalImpact, pathKm, referenceOrder } from "../decisionExplain";
import { DEFAULT_IMPACT_FACTORS } from "../impact";

const t = (min) => new Date(Date.UTC(2026, 9, 12, 9, min)).toISOString();
const depotV = { id: "V1", capacityLiters: 8000, depotLat: 26.33, depotLng: 43.95 };
// Planned order a,b,c; priority says b first; driver collected a,c,b.
const stops = [{ binId: "a", lat: 26.36, lng: 43.97, priorityScore: 50 }, { binId: "b", lat: 26.40, lng: 43.99, priorityScore: 90 }, { binId: "c", lat: 26.361, lng: 43.971, priorityScore: 70 }];
const route = { id: "R1", status: "completed", vehicleId: "V1", approvedAt: t(0), dispatch: { auto: true, at: t(0) }, completedAt: t(70), binIds: ["a", "b", "c"], orderedStops: stops };
const events = [
  { routeId: "R1", binId: "a", confirmedAt: t(20), fillBefore: 92 },
  { routeId: "R1", binId: "c", confirmedAt: t(30), fillBefore: 88 },
  { routeId: "R1", binId: "b", confirmedAt: t(80), fillBefore: 95 },
];
const decisions = [{ id: "d1", type: "create_assign", status: "executed", routeId: "R1", binIds: ["a", "b", "c"], executedAt: t(0) }];
const targets = { criticalCollectionMin: 60 };

describe("performance & impact — realised vs expected, against a reference route over the same bins", () => {
  it("realised figures come from the bins actually collected, in the order they were confirmed", () => {
    const r = operationalImpact({ routes: [route], events, decisions, vehicles: [depotV], targets }).realised;
    const done = ["a", "c", "b"].map((id) => ({ ...stops.find((s) => s.binId === id), fillLevelPercent: 0 }));
    expect(r.distanceKm).toBe(pathKm({ lat: 26.33, lng: 43.95 }, done));
    expect(r.referenceKm).toBe(pathKm({ lat: 26.33, lng: 43.95 }, referenceOrder(done)));
    expect(r.kmSaved).toBeCloseTo(Math.max(0, r.referenceKm - r.distanceKm), 1);
    expect(r.fuelL).toBeCloseTo(r.kmSaved * DEFAULT_IMPACT_FACTORS.fuelLitersPerKm, 1);
    expect(r.co2Kg).toBeCloseTo(r.fuelL * DEFAULT_IMPACT_FACTORS.co2KgPerLiter, 1);
    expect(r.binsCollected).toBe(3); expect(r.routesCompleted).toBe(1);
    expect(r.criticalMeasured).toBe(3);
    expect(r.onTimePct).toBe(67);            // 20 and 30 min ≤ 60, 80 min late
    expect(r.lateCritical).toBe(1);
    expect(r.avgResponseMin).toBe(43);       // (20+30+80)/3
    expect(r.utilizationPct).toBe(Math.round(((0.92 + 0.88 + 0.95) * 1100 / 8000) * 100));
    expect(r.autoDecisionsExecuted).toBe(1); expect(r.autoDecisionsSucceeded).toBe(1);
  });
  it("a missing factor makes fuel/emissions unavailable (null), never zero", () => {
    const r = operationalImpact({ routes: [route], events, decisions, vehicles: [depotV], targets, factors: { ...DEFAULT_IMPACT_FACTORS, fuelLitersPerKm: null } }).realised;
    expect(r.kmSaved).not.toBeNull(); expect(r.fuelL).toBeNull(); expect(r.co2Kg).toBeNull();
  });
  it("no data → every derived figure is null", () => {
    const r = operationalImpact({ routes: [], events: [], decisions: [], vehicles: [], targets }).realised;
    expect([r.kmSaved, r.fuelL, r.onTimePct, r.avgResponseMin, r.utilizationPct, r.distanceKm]).toEqual([null, null, null, null, null, null]);
    expect(r.binsCollected).toBe(0);
  });
  it("expected figures use the stored decision record of planned routes and are kept apart from realised ones", () => {
    const planned = { id: "R2", status: "approved", vehicleId: "V1", binIds: ["a", "b"], expectedCollectionMin: 45, dispatch: { explanation: { impact: { routeKm: 10, referenceKm: 13 } } } };
    const out = operationalImpact({ routes: [route, planned], events, decisions, vehicles: [depotV], targets });
    expect(out.expected).toMatchObject({ routesPlanned: 1, kmSaved: 3, avgExpectedCollectionMin: 45 });
    expect(out.realised.routesCompleted).toBe(1);
  });
  it("the time window excludes older activity", () => {
    const r = operationalImpact({ routes: [route], events, decisions, vehicles: [depotV], targets, from: Date.UTC(2026, 9, 13) }).realised;
    expect(r.routesCompleted).toBe(0); expect(r.kmSaved).toBeNull();
  });
});
