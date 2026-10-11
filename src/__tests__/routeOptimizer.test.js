import { describe, it, expect } from "vitest";
import { optimizeRoute, haversineMatrix, evaluateOrder, PRIORITY_WEIGHTS } from "../routeOptimizer";

// A straight east-west street: start at x=0, stops at x = 1..6 km (lat fixed). 1 km ≈ 0.009 deg lng at 26°N.
const LAT = 26.36, LNG0 = 43.90;
const atKm = (km) => ({ lat: LAT, lng: LNG0 + km * 0.01 });
const stop = (id, km, tier = "low", waste = 500, extra = {}) => ({ binId: id, binName: id, ...atKm(km), priorityTier: tier, priorityScore: tier === "critical" ? 90 : tier === "high" ? 70 : 20, wasteLiters: waste, ...extra });
const start = { ...atKm(0), label: "المستودع" };

describe("optimizeRoute — ordering", () => {
  it("fixes a deliberately bad order (zig-zag) into a monotone sweep", () => {
    const stops = [stop("a", 5), stop("b", 1), stop("c", 4), stop("d", 2), stop("e", 3)];
    const r = optimizeRoute({ start, stops, capacityLiters: 6000 });
    expect(r.ok).toBe(true);
    expect(r.orderedStops.map((s) => s.binId)).toEqual(["b", "d", "e", "c", "a"]);
    const before = evaluateOrder(start, stops, null);
    expect(r.totalDistanceKm).toBeLessThan(before.km);
  });

  it("pulls a critical bin earlier even when it is farther than a low one", () => {
    // Two low bins east (1, 2 km) and a critical bin 1 km west: a pure sweep east would leave
    // the critical bin last; the priority term pulls it first (arrival 2 min instead of 18).
    const stops = [stop("low1", 1, "low"), stop("low2", 2, "low"), stop("crit", -1, "critical")];
    const r = optimizeRoute({ start, stops, capacityLiters: 6000 });
    expect(r.orderedStops.map((s) => s.binId)[0]).toBe("crit");
    expect(r.objective.latenessCost).toBeGreaterThan(0);
    // and the trade-off is bounded: a critical bin 3 km away behind two low bins on the way is still swept in order
    const sweep = optimizeRoute({ start, stops: [stop("a", 1), stop("b", 2), stop("c", 3, "critical")], capacityLiters: 6000 });
    expect(sweep.orderedStops.map((s) => s.binId)).toEqual(["a", "b", "c"]);
  });

  it("is not nearest-neighbor: a greedy start is improved by local search", () => {
    // Greedy NN from 0 on these points would go 1 → 1.5 → 9 → 8 (3 km backtrack); optimum sweeps 1,1.5,8,9.
    const stops = [stop("p1", 1), stop("p2", 1.5), stop("p3", 9), stop("p4", 8)];
    const r = optimizeRoute({ start, stops, capacityLiters: 6000 });
    expect(r.orderedStops.map((s) => s.binId)).toEqual(["p1", "p2", "p4", "p3"]);
  });

  it("uses an OSRM matrix when supplied and reports high confidence; haversine fallback is flagged", () => {
    const stops = [stop("a", 1), stop("b", 2)];
    const points = [start, ...stops];
    const m = { ...haversineMatrix(points), source: "osrm" };
    const r = optimizeRoute({ start, stops, capacityLiters: 6000, matrix: m });
    expect(r.matrixSource).toBe("osrm");
    expect(r.confidence).toBe("high");
    expect(r.constraints.some((c) => c.includes("تقديرية"))).toBe(false);
    const f = optimizeRoute({ start, stops, capacityLiters: 6000 });
    expect(f.matrixSource).toBe("haversine");
    expect(f.confidence).not.toBe("high");
    expect(f.constraints.some((c) => c.includes("تقديرية"))).toBe(true);
  });
});

describe("optimizeRoute — capacity, dump site, shift", () => {
  it("splits into trips through the dump site when the load exceeds capacity", () => {
    const dump = { ...atKm(0.5), label: "محطة التحويل" };
    const stops = [stop("a", 1, "low", 3000), stop("b", 2, "low", 3000), stop("c", 3, "low", 3000)];
    const r = optimizeRoute({ start, stops, capacityLiters: 6500, dumpSite: dump });
    expect(r.trips).toBe(2);
    expect(r.orderedStops.some((o) => o.type === "dump")).toBe(true);
    expect(r.deferredStops).toEqual([]);
    expect(r.constraints.some((c) => c.includes("تُقسَّم"))).toBe(true);
    expect(r.estimatedWasteLiters).toBe(9000);
  });

  it("without a dump site, defers the lowest-priority stops and says so — never claims a full solution", () => {
    const stops = [stop("crit", 3, "critical", 3000), stop("low1", 1, "low", 3000), stop("low2", 2, "low", 3000)];
    const r = optimizeRoute({ start, stops, capacityLiters: 6500 });
    expect(r.orderedStops.map((s) => s.binId)).toContain("crit");
    expect(r.deferredStops.length).toBe(1);
    expect(r.deferredStops[0].priorityTier).toBe("low");
    expect(r.constraints.some((c) => c.includes("لا توجد نقطة تفريغ"))).toBe(true);
  });

  it("unknown capacity is reported as an unapplied constraint", () => {
    const r = optimizeRoute({ start, stops: [stop("a", 1)], capacityLiters: null });
    expect(r.constraints.some((c) => c.includes("سعة المركبة غير معروفة"))).toBe(true);
    expect(r.confidence).not.toBe("high");
  });

  it("flags shift overrun with the computed finish time", () => {
    const t0 = Date.parse("2026-10-11T06:00:00Z");
    const stops = [stop("a", 10), stop("b", 20), stop("c", 30)];
    const r = optimizeRoute({ start, stops, capacityLiters: 6000, timeWindow: { startAt: t0, shiftEnd: t0 + 30 * 60000 } });
    expect(r.finishAt).toBeTruthy();
    expect(r.overrunMin).toBeGreaterThan(0);
    expect(r.constraints.some((c) => c.includes("نهاية المناوبة"))).toBe(true);
  });

  it("stops without coordinates are appended and reported; missing start fails explicitly", () => {
    const r = optimizeRoute({ start, stops: [stop("a", 1), { binId: "x", binName: "x", priorityTier: "low" }], capacityLiters: 6000 });
    expect(r.orderedStops.at(-1).binId).toBe("x");
    expect(r.orderedStops.at(-1).hasCoords).toBe(false);
    expect(r.constraints.some((c) => c.includes("بلا إحداثيات"))).toBe(true);
    expect(optimizeRoute({ start: null, stops: [stop("a", 1)] }).ok).toBe(false);
  });

  it("outputs distance, time (drive + service), waste and the objective breakdown", () => {
    const stops = [stop("a", 1, "low", 700), stop("b", 2, "low", 800)];
    const r = optimizeRoute({ start, stops, capacityLiters: 6000, serviceMinutesPerStop: 4 });
    expect(r.totalDistanceKm).toBeCloseTo(2, 0);
    expect(r.totalDurationMin).toBe(r.driveMin + 8);
    expect(r.estimatedWasteLiters).toBe(1500);
    expect(r.objective.improvementPct).toBeGreaterThanOrEqual(0);
    expect(PRIORITY_WEIGHTS.critical).toBeGreaterThan(PRIORITY_WEIGHTS.high);
  });
});
