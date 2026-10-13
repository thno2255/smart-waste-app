import { describe, it, expect } from "vitest";
import { evaluateFeasibility, buildOperationalModel, evaluateCrewTimeline, checkCrewAssignment, FEASIBILITY_STATUS as FS } from "../operationalFeasibilityEngine";

const NOW = Date.UTC(2026, 9, 13, 7, 0, 0); // 10:00 local
const fresh = new Date(NOW - 60000).toISOString();
const nb = [{ id: "n1", name: "حي الشمال", municipalityId: "north" }, { id: "n2", name: "حي الربوة", municipalityId: "north" }];
const bin = (id, fill, i = 0, nid = "n1", extra = {}) => ({ id, name: id, neighborhoodId: nid, municipalityId: "north", lastFillLevelPercent: fill, lastTemperatureCelsius: 25, lastReadingAt: fresh, lat: 26.41 + i * 0.002, lng: 43.96 + i * 0.002, capacityLiters: 1100, demo: true, ...extra });
const prof = (uid, extra = {}) => ({ uid, fullName: uid, municipalityId: "north", accountStatus: "active", shiftStatus: "on_shift", availability: "available", vehicleId: "V" + uid, neighborhoodKeys: ["الشمال", "الربوة"], shiftStart: "06:00", shiftEnd: "14:00", lastLocation: { lat: 26.40, lng: 43.95, at: fresh }, ...extra });
const veh = (id, cap = 8000, extra = {}) => ({ id, vehicleNumber: id, status: "available", capacityLiters: cap, depotLat: 26.40, depotLng: 43.95, municipalityId: "north", ...extra });
const st = (over = {}) => ({ municipalityId: "north", neighborhoods: nb, bins: [bin("a", 95, 0), bin("b", 92, 1), bin("c", 90, 2)], profiles: [prof("D1")], vehicles: [veh("VD1")], routes: [], incidents: [], ...over });
const run = (s, o = {}) => evaluateFeasibility(s, { now: NOW, ...o });

describe("operationalFeasibilityEngine — statuses", () => {
  it("FEASIBLE: one crew, room, time → every due bin served within the target", () => {
    const r = run(st());
    expect(r.feasibilityStatus).toBe(FS.FEASIBLE);
    expect(r.unservedBins).toEqual([]);
    expect(r.solverStatus.algorithm).toMatch(/local search/);
    expect(r.estimatedCompletionTime).not.toBeNull();
    expect(r.constraintsEvaluated.find((c) => c.code === "VEHICLE_CAPACITY").hard).toBe(true);
  });
  it("PROVEN_INFEASIBLE (capacity): total waste > total remaining capacity, no dump site", () => {
    const r = run(st({ vehicles: [veh("VD1", 2000)] }));
    expect(r.feasibilityStatus).toBe(FS.PROVEN_INFEASIBLE);
    expect(r.cause).toBe("CAPACITY");
    expect(r.proofs.map((p) => p.code)).toContain("CAPACITY_TOTAL");
  });
  it("a dump site turns the same load into a multi-trip feasible plan (never assumed when absent)", () => {
    const r = run(st({ vehicles: [veh("VD1", 2000)], dumpSites: [{ id: "dump1", lat: 26.405, lng: 43.955 }] }));
    expect(r.feasibilityStatus).toBe(FS.FEASIBLE);
  });
  it("PROVEN_INFEASIBLE (shift): no usable crew — the only driver is off shift", () => {
    const r = run(st({ profiles: [prof("D1", { shiftStatus: "off_shift" })] }));
    expect(r.feasibilityStatus).toBe(FS.PROVEN_INFEASIBLE);
    expect(r.cause).toBe("NO_QUALIFIED_DRIVER");
  });
  it("PROVEN_INFEASIBLE (time): the nearest usable crew cannot reach a critical bin within the target", () => {
    const r = run(st({ profiles: [prof("D1", { lastLocation: { lat: 27.40, lng: 44.95, at: fresh } })] }));
    expect(r.feasibilityStatus).toBe(FS.PROVEN_INFEASIBLE);
    expect(r.proofs.some((p) => p.code === "UNREACHABLE_IN_TIME")).toBe(true);
  });
  it("PROVEN_INFEASIBLE (coverage): no usable crew covers the neighbourhood", () => {
    const r = run(st({ profiles: [prof("D1", { neighborhoodKeys: ["الربوة"] })] }));
    expect(r.feasibilityStatus).toBe(FS.PROVEN_INFEASIBLE);
    expect(r.cause).toBe("COVERAGE");
  });
  it("NO_SOLUTION_FOUND: each truck fits one bin; the total fits but the bins cannot be packed (not proven by the bounds)", () => {
    const r = run(st({ profiles: [prof("D1"), prof("D2")], vehicles: [veh("VD1", 1600), veh("VD2", 1600)] }));
    expect(r.feasibilityStatus).toBe(FS.NO_SOLUTION_FOUND);
    expect(r.unservedBins.length).toBe(1);
    expect(r.blockingConstraintCodes).toContain("VEHICLE_CAPACITY");
  });
  it("INSUFFICIENT_DATA: unknown vehicle capacity is never read as 'fits'", () => {
    const r = run(st({ vehicles: [veh("VD1", null)] }));
    expect(r.feasibilityStatus).toBe(FS.INSUFFICIENT_DATA);
    expect(r.missingData.map((m) => m.code)).toContain("CAPACITY_UNKNOWN");
  });
  it("INSUFFICIENT_DATA: no start point (no live location, no depot)", () => {
    const r = run(st({ profiles: [prof("D1", { lastLocation: null })], vehicles: [veh("VD1", 8000, { depotLat: null, depotLng: null })] }));
    expect([FS.INSUFFICIENT_DATA, FS.PROVEN_INFEASIBLE]).toContain(r.feasibilityStatus);
    expect(r.missingData.map((m) => m.code)).toContain("ORIGIN_UNKNOWN");
  });
  it("TIME_LIMIT: the search stops at its limit and does not claim infeasibility", () => {
    let t = 0; const clock = () => (t += 1000);
    const r = run(st({ profiles: [prof("D1"), prof("D2")], vehicles: [veh("VD1", 1600), veh("VD2", 1600)] }), { timeLimitMs: 1, clock });
    expect(r.feasibilityStatus).toBe(FS.TIME_LIMIT);
    expect(r.solverStatus.timedOut).toBe(true);
  });
  it("ERROR: a failing input is reported, not hidden", () => {
    const bad = st(); Object.defineProperty(bad, "profiles", { get() { throw new Error("boom"); } });
    const r = run(bad);
    expect(r.feasibilityStatus).toBe(FS.ERROR);
    expect(r.error).toMatch(/boom/);
  });
});

describe("operationalFeasibilityEngine — hard constraints are never a cost", () => {
  it("the near driver who does not cover the area is not used even though cheaper; the far covering one is", () => {
    const r = run(st({ profiles: [prof("NEAR", { neighborhoodKeys: ["الربوة"] }), prof("FAR", { lastLocation: { lat: 26.30, lng: 43.85, at: fresh } })], vehicles: [veh("VNEAR"), veh("VFAR")] }), { settings: { targets: { criticalCollectionMin: 240 } } });
    expect(r.feasibilityStatus).toBe(FS.FEASIBLE);
    const used = Object.entries(r.plan.crews).filter(([, segs]) => segs.some((s) => s.binIds.length)).map(([id]) => id);
    expect(used).toEqual(["FAR"]);
  });
  it("crew timeline: shift end, capacity and dump trip are checked stop by stop", () => {
    const model = buildOperationalModel(st({ profiles: [prof("D1", { shiftEnd: "10:05" })] }), { now: NOW });
    const crew = model.crews[0];
    const e = evaluateCrewTimeline(crew, [{ routeId: null, binIds: ["a", "b", "c"], added: [] }], model);
    expect(e.violations.map((v) => v.code)).toContain("SHIFT_END");
  });
  it("return to depot is included when required, and missing depot makes the plan unverifiable", () => {
    const withReturn = checkCrewAssignment(st(), { driverId: "D1", binIds: ["a", "b", "c"] }, { now: NOW, policy: { returnToDepotRequired: true } });
    const without = checkCrewAssignment(st(), { driverId: "D1", binIds: ["a", "b", "c"] }, { now: NOW });
    expect(withReturn.finishMin).toBeGreaterThan(without.finishMin);
    const noDepot = checkCrewAssignment(st({ vehicles: [veh("VD1", 8000, { depotLat: null, depotLng: null })] }), { driverId: "D1", binIds: ["a"] }, { now: NOW, policy: { returnToDepotRequired: true } });
    expect(noDepot.feasible).toBe(false);
    expect(noDepot.missing.map((m) => m.code)).toContain("DEPOT_UNKNOWN");
  });
  it("existing commitments come first: a crew finishing a long route reaches new bins later", () => {
    const stops = Array.from({ length: 6 }, (_, i) => ({ order: i + 1, binId: `p${i}`, lat: 26.30 + i * 0.01, lng: 43.90, fillLevelPercent: 40 }));
    const busy = { id: "RUN", routeName: "RUN", status: "in_progress", driverId: "D1", vehicleId: "VD1", binIds: stops.map((s) => s.binId), orderedStops: stops, collectedBinIds: [], estimatedWasteLiters: 2600, startedAt: fresh };
    const free = checkCrewAssignment(st(), { driverId: "D1", binIds: ["a"] }, { now: NOW });
    const after = checkCrewAssignment(st({ routes: [busy] }), { driverId: "D1", binIds: ["a"], overrideNewWork: true }, { now: NOW });
    expect(after.times.a).toBeGreaterThan(free.times.a);
  });
  it("deterministic", () => {
    const s = st({ profiles: [prof("D1"), prof("D2")], vehicles: [veh("VD1", 1600), veh("VD2", 1600)] });
    const a = run(s), b = run(s);
    expect(JSON.stringify(a.plan)).toBe(JSON.stringify(b.plan));
  });
});
