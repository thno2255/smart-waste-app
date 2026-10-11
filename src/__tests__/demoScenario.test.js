import { describe, it, expect } from "vitest";
import { DEMO_STEPS, evaluateDemo, nextStepIndex } from "../demoScenario";

const bins = [
  { id: "b1", municipalityId: "east", lastFillLevelPercent: 90 },
  { id: "b2", municipalityId: "east", lastFillLevelPercent: 40 },
  { id: "b3", municipalityId: "north", lastFillLevelPercent: 95 },
];
const keyAt = (s, live) => { const i = nextStepIndex(s, evaluateDemo(s, live)).index; return i >= DEMO_STEPS.length ? "DONE" : DEMO_STEPS[i].key; };

describe("demo scenario", () => {
  it("has the 21 ordered steps the panel walks through (amanah → operations → driver → shortage → transfer → KPIs)", () => {
    expect(DEMO_STEPS.length).toBe(21);
    expect(DEMO_STEPS.map((s) => s.key)).toEqual(["city", "amanah", "pick", "show", "fill", "detect", "predict", "plan", "route", "driver", "approve", "inbox", "navigate", "collect", "indicators", "shortage", "support", "recommend", "transferApprove", "transferExecute", "kpis"]);
    expect(new Set(DEMO_STEPS.map((s) => s.kind))).toEqual(new Set(["nav", "choose", "observe", "action"]));
  });
  it("evaluates observe-steps from live data, scoped to the chosen municipality", () => {
    const e = evaluateDemo({ municipalityId: "east" }, { bins, routes: [], profiles: [] });
    expect(e.munBins).toBe(2); expect(e.critical).toBe(1);
    expect(e.show.done).toBe(true); expect(e.detect.done).toBe(true); expect(e.route.done).toBe(false);
    expect(e.predict.done).toBe(false);
    const withSeries = evaluateDemo({ municipalityId: "east" }, { bins, readings: [{ bin_id: "b1" }, { bin_id: "b1" }, { bin_id: "b3" }, { bin_id: "b3" }] });
    expect(withSeries.predict.done).toBe(true); expect(withSeries.predictable).toBe(1); // b3 is in another municipality
  });
  it("walks forward as the session and live data progress", () => {
    let s = {};
    expect(keyAt(s, { bins, routes: [] })).toBe("city");
    s = { visitedCity: true }; expect(keyAt(s, { bins })).toBe("amanah");
    s = { ...s, visitedAmanah: true }; expect(keyAt(s, { bins })).toBe("pick");
    s = { ...s, municipalityId: "east" }; expect(keyAt(s, { bins })).toBe("fill"); // show+detect already true from data
    const readings = [{ bin_id: "b1" }, { bin_id: "b1" }];
    s = { ...s, firedEvents: 3 }; expect(keyAt(s, { bins })).toBe("predict"); expect(keyAt(s, { bins, readings })).toBe("plan");
    const runs = [{ municipalityId: "east", createdAt: "2026-10-12T10:00:00.000Z", summary: { routes: 1, served: 1 } }];
    expect(keyAt(s, { bins, readings, runs })).toBe("route");
    const route = { id: "R1", routeName: "جولة", status: "suggested", binIds: ["b1"], orderedStops: [{ binId: "b1" }], collectedBinIds: [] };
    s = { ...s, routeId: "R1" }; expect(keyAt(s, { bins, readings, runs, routes: [route] })).toBe("driver");
    s = { ...s, recommendedDriverName: "أحمد", driverId: "D1", criticalBefore: 1 };
    expect(keyAt(s, { bins, readings, runs, routes: [route] })).toBe("approve");
    const approved = { ...route, status: "approved", driverId: "D1", driverName: "أحمد" };
    expect(keyAt(s, { bins, readings, runs, routes: [approved] })).toBe("navigate");
    const started = { ...approved, status: "in_progress" };
    expect(keyAt(s, { bins, readings, runs, routes: [started], profiles: [{ uid: "D1", lastLocation: { lat: 1, lng: 2 } }] })).toBe("collect");
    const collected = { ...started, collectedBinIds: ["b1"] };
    expect(keyAt(s, { bins, readings, runs, routes: [collected] })).toBe("indicators");
    const binsAfter = bins.map((b) => (b.id === "b1" ? { ...b, lastFillLevelPercent: 5 } : b));
    const fin = evaluateDemo(s, { bins: binsAfter, routes: [collected] });
    expect(fin.indicators.done).toBe(true); expect(fin.indicators.detail).toContain("1 ← 0");
    // per-route comparison: other municipality bins filling up must not mask the effect
    const noisy = [...binsAfter, { id: "b9", municipalityId: "east", lastFillLevelPercent: 99 }];
    expect(evaluateDemo({ ...s, routeCriticalBefore: 1 }, { bins: noisy, routes: [collected] }).indicators.done).toBe(true);
    expect(evaluateDemo({ ...s, criticalBefore: 1 }, { bins: noisy, routes: [collected] }).indicators.done).toBe(true);
    const notYetEmptied = bins.map((b) => (b.id === "b1" ? { ...b, lastFillLevelPercent: 90 } : b));
    expect(evaluateDemo({ ...s, criticalBefore: 1 }, { bins: [...notYetEmptied, noisy.at(-1)], routes: [collected] }).indicators.done).toBe(false);
    // critical dropped to 0, so "detect" is no longer live-true — monotonic completion keeps it done
    expect(nextStepIndex(s, fin).index).toBe(DEMO_STEPS.findIndex((x) => x.key === "detect"));
    s = { ...s, completedKeys: ["detect", "predict", "plan"] };
    expect(keyAt(s, { bins: binsAfter, routes: [collected] })).toBe("shortage");
    // Amanah leg: scenario → support request → transfer proposed → approved → executed → decisions logged
    const scenarios = [{ municipalityId: "east", createdAt: "2026-10-12T10:05:00.000Z", scenario: { type: "vehicle_down" }, verdict: "worse", baseline: { unserved: 0, pressure: 20 }, result: { unserved: 3, pressure: 60 } }];
    const live = { bins: binsAfter, routes: [collected], scenarios };
    expect(keyAt(s, live)).toBe("support");
    expect(evaluateDemo(s, live).shortage.detail).toContain("أسوأ");
    live.supportRequests = [{ municipalityId: "east", createdAt: "2026-10-12T10:06:00.000Z", need: "مركبة", pressureIndex: 60, status: "open" }];
    expect(keyAt(s, live)).toBe("recommend");
    live.transfers = [{ toMunicipalityId: "east", fromMunicipalityId: "south", createdAt: "2026-10-12T10:07:00.000Z", status: "proposed", resourceLabel: "مركبة 5", impact: { receiverBefore: 60, receiverAfter: 30 } }];
    expect(keyAt(s, live)).toBe("transferApprove");
    live.transfers[0].status = "approved"; expect(keyAt(s, live)).toBe("transferExecute");
    live.transfers[0].status = "executed"; expect(keyAt(s, live)).toBe("kpis");
    live.audit = ["route_assigned", "decision_simulated", "transfer_proposed", "transfer_approved", "transfer_executed"].map((action, i) => ({ action, createdAt: `2026-10-12T10:0${i}:00.000Z` }));
    expect(keyAt(s, live)).toBe("DONE");
    // artefacts from BEFORE the session never count
    const old = { ...s, startedAt: "2026-10-12T11:00:00.000Z" };
    expect(evaluateDemo(old, live).shortage.done).toBe(false); expect(evaluateDemo(old, live).recommend.done).toBe(false);
    // a transfer sent TO another municipality is not this municipality's step
    expect(evaluateDemo(s, { ...live, transfers: [{ ...live.transfers[0], toMunicipalityId: "north" }] }).recommend.done).toBe(false);
  });
});
