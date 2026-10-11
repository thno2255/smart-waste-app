import { describe, it, expect } from "vitest";
import { DEMO_STEPS, evaluateDemo, nextStepIndex } from "../demoScenario";

const bins = [
  { id: "b1", municipalityId: "east", lastFillLevelPercent: 90 },
  { id: "b2", municipalityId: "east", lastFillLevelPercent: 40 },
  { id: "b3", municipalityId: "north", lastFillLevelPercent: 95 },
];

describe("demo scenario", () => {
  it("has the 12 ordered steps the panel walks through", () => {
    expect(DEMO_STEPS.length).toBe(12);
    expect(DEMO_STEPS[0].key).toBe("city"); expect(DEMO_STEPS.at(-1).key).toBe("indicators");
  });
  it("evaluates observe-steps from live data, scoped to the chosen municipality", () => {
    const e = evaluateDemo({ municipalityId: "east" }, { bins, routes: [], profiles: [] });
    expect(e.munBins).toBe(2); expect(e.critical).toBe(1);
    expect(e.show.done).toBe(true); expect(e.detect.done).toBe(true); expect(e.route.done).toBe(false);
  });
  it("walks forward as the session and live data progress", () => {
    let s = {};
    let e = evaluateDemo(s, { bins, routes: [] });
    expect(nextStepIndex(s, e).index).toBe(0);
    s = { visitedCity: true }; expect(nextStepIndex(s, evaluateDemo(s, { bins })).index).toBe(1);
    s = { ...s, municipalityId: "east" }; expect(nextStepIndex(s, evaluateDemo(s, { bins })).index).toBe(3); // show+detect already true from data
    s = { ...s, firedEvents: 3 }; expect(nextStepIndex(s, evaluateDemo(s, { bins })).index).toBe(5);
    const route = { id: "R1", routeName: "جولة", status: "suggested", binIds: ["b1"], orderedStops: [{ binId: "b1" }], collectedBinIds: [] };
    s = { ...s, routeId: "R1" }; expect(nextStepIndex(s, evaluateDemo(s, { bins, routes: [route] })).index).toBe(6);
    s = { ...s, recommendedDriverName: "أحمد", driverId: "D1", criticalBefore: 1 };
    expect(nextStepIndex(s, evaluateDemo(s, { bins, routes: [route] })).index).toBe(7);
    const approved = { ...route, status: "approved", driverId: "D1", driverName: "أحمد" };
    expect(nextStepIndex(s, evaluateDemo(s, { bins, routes: [approved] })).index).toBe(9);
    const started = { ...approved, status: "in_progress" };
    expect(nextStepIndex(s, evaluateDemo(s, { bins, routes: [started], profiles: [{ uid: "D1", lastLocation: { lat: 1, lng: 2 } }] })).index).toBe(10);
    const collected = { ...started, collectedBinIds: ["b1"] };
    expect(nextStepIndex(s, evaluateDemo(s, { bins, routes: [collected] })).index).toBe(11);
    const binsAfter = bins.map((b) => (b.id === "b1" ? { ...b, lastFillLevelPercent: 5 } : b));
    const fin = evaluateDemo(s, { bins: binsAfter, routes: [collected] });
    expect(fin.indicators.done).toBe(true); expect(fin.indicators.detail).toContain("1 ← 0");
    // per-route comparison: other municipality bins filling up must not mask the effect
    const noisy = [...binsAfter, { id: "b9", municipalityId: "east", lastFillLevelPercent: 99 }];
    expect(evaluateDemo({ ...s, routeCriticalBefore: 1 }, { bins: noisy, routes: [collected] }).indicators.done).toBe(true);
    // a collected bin whose sensor now reads emptied proves the step even when the municipality count did not drop
    expect(evaluateDemo({ ...s, criticalBefore: 1 }, { bins: noisy, routes: [collected] }).indicators.done).toBe(true);
    const notYetEmptied = bins.map((b) => (b.id === "b1" ? { ...b, lastFillLevelPercent: 90 } : b));
    expect(evaluateDemo({ ...s, criticalBefore: 1 }, { bins: [...notYetEmptied, noisy.at(-1)], routes: [collected] }).indicators.done).toBe(false);
    // critical dropped to 0, so "detect" is no longer live-true — monotonic completion keeps it done
    expect(nextStepIndex(s, fin).index).toBe(4);
    expect(nextStepIndex({ ...s, completedKeys: ["detect"] }, fin).index).toBe(12);
    expect(nextStepIndex(s, evaluateDemo(s, { bins, routes: [collected] })).newlyPassed).toContain("detect");
  });
});
