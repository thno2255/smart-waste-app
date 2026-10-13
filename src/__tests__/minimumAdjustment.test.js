/**
 * Minimum Operational Adjustment Engine — operational scenarios (engine only, no UI, no Firestore).
 * Numbers in the assertions come from the engine; the fixtures only set up the situation.
 */
import { describe, it, expect } from "vitest";
import { analyzeMinimumAdjustment, adjustmentSummary, stateFingerprint } from "../minimumOperationalAdjustmentEngine";

const NOW = Date.UTC(2026, 9, 13, 7, 0, 0); // 10:00 local
const fresh = new Date(NOW - 60000).toISOString();
const O = { lat: 26.40, lng: 43.95 };
const nb = [{ id: "n1", name: "حي الشمال", municipalityId: "north" }, { id: "n2", name: "حي الربوة", municipalityId: "north" }];
const bin = (id, fill, lat, lng, extra = {}) => ({ id, name: id, neighborhoodId: "n1", municipalityId: "north", lastFillLevelPercent: fill, lastTemperatureCelsius: 25, lastReadingAt: fresh, lat, lng, capacityLiters: 1100, demo: true, simulated: true, ...extra });
const near = (id, fill, i) => bin(id, fill, O.lat + 0.004 + i * 0.002, O.lng + 0.004 + i * 0.002);
const prof = (uid, extra = {}) => ({ uid, fullName: uid, municipalityId: "north", accountStatus: "active", shiftStatus: "on_shift", availability: "available", vehicleId: "V" + uid, neighborhoodKeys: ["الشمال", "الربوة"], shiftStart: "06:00", shiftEnd: "18:00", lastLocation: { ...O, at: fresh }, ...extra });
const veh = (id, cap = 8000, extra = {}) => ({ id, vehicleNumber: id, status: "available", capacityLiters: cap, depotLat: O.lat, depotLng: O.lng, municipalityId: "north", ...extra });
const crit3 = () => [near("a", 95, 0), near("b", 92, 1), near("c", 90, 2)];
const st = (over = {}) => ({ municipalityId: "north", neighborhoods: nb, depot: O, bins: crit3(), profiles: [prof("D1")], vehicles: [veh("VD1")], routes: [], incidents: [], ...over });
const run = (s, o = {}) => analyzeMinimumAdjustment(s, { now: NOW, ...o });
const codes = (alt) => alt.interventions.map((i) => i.code);

describe("minimum adjustment — deficits and their causes", () => {
  it("no deficit → no adjustment proposed", () => {
    const r = run(st());
    expect(r.status).toBe("NO_DEFICIT");
    expect(r.needed).toBe(false);
  });
  it("1. capacity deficit: cause = capacity; an idle in-municipality vehicle is preferred to an extra crew", () => {
    const r = run(st({ profiles: [prof("D1"), prof("D2", { vehicleId: null })], vehicles: [veh("VD1", 2500), veh("VSPARE", 8000)] }));
    expect(r.deficit.cause).toBe("CAPACITY");
    expect(r.status).toBe("RECOMMENDATION");
    expect(codes(r.recommended)).toEqual(["IDLE_VEHICLE"]);
    const add = r.alternatives.find((x) => codes(x).join() === "ADD_RESOURCE");
    expect(add.verdict).toBe("COSTLIER");
  });
  it("2. shift ending: the driver's shift ends first → a covering driver scheduled at his shift start", () => {
    const r = run(st({ profiles: [prof("D1", { shiftEnd: "10:05" }), prof("D2", { shiftStatus: "off_shift", shiftStart: "10:20", shiftEnd: "18:00" })], vehicles: [veh("VD1"), veh("VD2")] }));
    expect(["SHIFT", "NO_QUALIFIED_DRIVER", "TIME", "WORKLOAD"]).toContain(r.deficit.cause);
    expect(codes(r.recommended)).toContain("SHIFT_TIMING");
    expect(r.recommended.slaMet).toBe(true);
  });
  it("3. no qualified driver (account inactive) → cause NO_QUALIFIED_DRIVER", () => {
    const r = run(st({ profiles: [prof("D1", { accountStatus: "suspended" })] }));
    expect(r.deficit.cause).toBe("NO_QUALIFIED_DRIVER");
  });
});

describe("minimum adjustment — internal measures first", () => {
  it("4. re-sequencing a running route brings a late critical bin within the target", () => {
    const far = (i) => ({ binId: `p${i}`, lat: O.lat + 0.05 * (i + 1), lng: O.lng, fillLevelPercent: 30 });
    const stops = [far(0), far(1), far(2), far(3), { binId: "crit", lat: O.lat - 0.004, lng: O.lng, fillLevelPercent: 96 }].map((s, i) => ({ ...s, order: i + 1 }));
    const run1 = { id: "RUN", routeName: "جولة الشمال", status: "in_progress", driverId: "D1", vehicleId: "VD1", neighborhoodIds: ["n1"], binIds: stops.map((s) => s.binId), orderedStops: stops, collectedBinIds: [], estimatedWasteLiters: 2400, startedAt: fresh };
    const r = run(st({ bins: [bin("crit", 96, O.lat - 0.004, O.lng)], routes: [run1] }));
    expect(r.deficit.late).toBeGreaterThan(0);
    expect(codes(r.recommended)).toEqual(["RESEQUENCE"]);
    expect(r.recommended.diff.routeChanges[0].reordered).toBe(true);
    expect(r.recommended.interventions[0].authority).toBe("employee");
  });
  it("5. redistributing a queued route to an idle driver serves its critical bins in time", () => {
    const longStops = Array.from({ length: 5 }, (_, i) => ({ order: i + 1, binId: `q${i}`, lat: O.lat + 0.05 * (i + 1), lng: O.lng, fillLevelPercent: 30 }));
    const running = { id: "RUN", routeName: "جولة جارية", status: "in_progress", driverId: "D1", vehicleId: "VD1", neighborhoodIds: ["n1"], binIds: longStops.map((s) => s.binId), orderedStops: longStops, collectedBinIds: [], estimatedWasteLiters: 1700, startedAt: fresh };
    const queued = { id: "NEXT", routeName: "جولة تالية", status: "approved", driverId: "D1", vehicleId: "VD1", neighborhoodIds: ["n1"], binIds: ["a", "b", "c"], orderedStops: crit3().map((b, i) => ({ order: i + 1, binId: b.id, lat: b.lat, lng: b.lng, fillLevelPercent: b.lastFillLevelPercent })), collectedBinIds: [], estimatedWasteLiters: 3000, dispatch: { reservedAfterRouteId: "RUN" }, approvedAt: fresh };
    const r = run(st({ profiles: [prof("D1"), prof("D2")], vehicles: [veh("VD1"), veh("VD2")], routes: [running, queued] }));
    expect(r.deficit.late).toBeGreaterThan(0);
    expect(codes(r.recommended)).toEqual(["REDISTRIBUTE"]);
    const ch = r.recommended.diff.routeChanges.find((x) => x.routeId === "NEXT");
    expect(ch.removed.length).toBe(3);
    expect(r.recommended.diff.newRoutes[0].crewId).toBe("D2");
  });
});

describe("minimum adjustment — resources, cost and hard constraints", () => {
  it("6. no solution without resources → extra crew (external action); when not allowed → NO_VALID_ADJUSTMENT", () => {
    const s = st({ vehicles: [veh("VD1", 2500)] });
    const r = run(s);
    expect(codes(r.recommended)).toEqual(["ADD_RESOURCE"]);
    expect(r.recommended.requiresExternalAction).toBe(true);
    expect(r.recommended.simulated).toBe(true);
    const none = run(s, { policy: { allowed: { ADD_RESOURCE: false, LOAN: false } } });
    expect(none.status).toBe("NO_VALID_ADJUSTMENT");
    expect(none.recommended).toBeNull();
    expect(adjustmentSummary(none)).toMatch(/لم يحقق أي تعديل/);
  });
  it("7. a cheaper alternative that would break a hard constraint is not chosen, and the constraint is named", () => {
    // D1 is busy until late; reserving his next route is the cheapest measure, but his shift ends before he could serve.
    const long = Array.from({ length: 6 }, (_, i) => ({ order: i + 1, binId: `l${i}`, lat: O.lat + 0.04 * (i + 1), lng: O.lng, fillLevelPercent: 30 }));
    const busy = { id: "RUN", routeName: "RUN", status: "in_progress", driverId: "D1", vehicleId: "VD1", neighborhoodIds: ["n1"], binIds: long.map((s) => s.binId), orderedStops: long, collectedBinIds: [], estimatedWasteLiters: 2000, startedAt: fresh };
    const r = run(st({ profiles: [prof("D1", { shiftEnd: "11:30" })], routes: [busy] }));
    const reserve = r.alternatives.find((x) => codes(x).join() === "RESERVE_NEXT:D1".split(":")[0]);
    expect(reserve.verdict).not.toBe("CHOSEN");
    expect(reserve.rejectReason).toMatch(/المناوبة/);
    expect(codes(r.recommended)).toContain("ADD_RESOURCE");
  });
  it("8. a valid but more expensive alternative is listed as COSTLIER with the difference", () => {
    const r = run(st({ profiles: [prof("D1", { shiftStatus: "off_shift", shiftStart: "10:10", shiftEnd: "18:00" })] }));
    expect(codes(r.recommended)).toEqual(["SHIFT_TIMING"]);
    const add = r.alternatives.find((x) => codes(x).join() === "ADD_RESOURCE");
    expect(add.success).toBe(true);
    expect(add.verdict).toBe("COSTLIER");
    expect(add.rejectReason).toMatch(/أعلى تكلفة \(\+\d+/);
  });
  it("19. unknown money cost stays null (never 0); simulation factors are labelled", () => {
    const real = run(st({ vehicles: [veh("VD1", 2500)], bins: crit3().map((b) => ({ ...b, demo: false, simulated: false })) }));
    expect(real.recommended.money.value).toBeNull();
    expect(real.recommended.money.text).toMatch(/غير متاحة/);
    const sim = run(st({ vehicles: [veh("VD1", 2500)] }));
    expect(sim.recommended.money.kind).toBe("simulation");
    expect(sim.costModel.money.source).toMatch(/بيئة المحاكاة/);
  });
});

describe("minimum adjustment — loans protect the lending municipality", () => {
  const donorState = (over = {}) => ({ municipalityId: "west", neighborhoods: [{ id: "w1", name: "حي الغرب", municipalityId: "west" }], depot: { lat: 26.38, lng: 43.92 }, bins: [],
    profiles: [{ ...prof("W1"), municipalityId: "west", vehicleId: "VW1", neighborhoodKeys: ["الغرب"], lastLocation: { lat: 26.385, lng: 43.925, at: fresh } }],
    vehicles: [{ ...veh("VW1"), municipalityId: "west", depotLat: 26.38, depotLng: 43.92 }], routes: [], incidents: [], ...over });
  const receiver = () => st({ vehicles: [veh("VD1", 2500)] });
  it("10. a loan valid for both sides is preferred to an extra crew", () => {
    const r = run(receiver(), { donors: [{ municipalityId: "west", name: "الغرب", state: donorState() }] });
    expect(codes(r.recommended)).toEqual(["LOAN"]);
    expect(r.recommended.donorChecks[0].ok).toBe(true);
    expect(r.recommended.interventions[0].window.endAt > r.recommended.interventions[0].window.startAt).toBe(true);
    expect(r.recommended.authority).toBe("executive");
  });
  it("9. a loan that solves the receiver's deficit but creates one at the lender is rejected", () => {
    const wb = [{ id: "w-a", name: "w-a", neighborhoodId: "w1", municipalityId: "west", lastFillLevelPercent: 96, lastTemperatureCelsius: 25, lastReadingAt: fresh, lat: 26.386, lng: 43.926, capacityLiters: 1100, demo: true }];
    const r = run(receiver(), { donors: [{ municipalityId: "west", name: "الغرب", state: donorState({ bins: wb }) }] });
    const loan = r.alternatives.find((x) => codes(x).join() === "LOAN");
    expect(loan.verdict).toBe("REJECTED_DONOR");
    expect(loan.rejectReason).toMatch(/الغرب/);
    expect(codes(r.recommended)).not.toContain("LOAN");
  });
  it("a resource already reserved in an overlapping window is not offered", () => {
    const res = [{ resourceId: "W1", startAt: new Date(NOW - 60000).toISOString(), endAt: new Date(NOW + 6 * 3600000).toISOString(), status: "active" }];
    const r = run(receiver(), { donors: [{ municipalityId: "west", name: "الغرب", state: donorState() }], existingReservations: res });
    expect(r.alternatives.some((x) => codes(x).includes("LOAN"))).toBe(false);
    expect(r.rejectedCandidates.some((x) => x.code === "LOAN" && /محجوز/.test(x.reason))).toBe(true);
  });
});

describe("minimum adjustment — search limits, data, explanation, safety", () => {
  it("14. time limit: the search stops, says so, and never claims a global optimum", () => {
    let t = 0;
    const r = run(st({ vehicles: [veh("VD1", 2000)] }), { clock: () => (t += 2000), policy: { timeLimitMs: 3000 } });
    expect(r.search.status).toBe("TIME_LIMIT");
    expect(r.search.setsEvaluated).toBeLessThan(r.search.setsTotal);
    expect(r.search.optimality).not.toMatch(/GLOBAL/);
  });
  it("15. missing data: an unknown capacity is reported, the deficit cause is DATA", () => {
    const r = run(st({ vehicles: [veh("VD1", null)] }));
    expect(r.base.feasibilityStatus).toBe("INSUFFICIENT_DATA");
    expect(r.deficit.cause).toBe("DATA");
    expect(r.deficit.missing.map((m) => m.code)).toContain("CAPACITY_UNKNOWN");
  });
  it("20. no depot and no start point: the extra crew is not fabricated", () => {
    const r = run(st({ depot: null, profiles: [prof("D1", { accountStatus: "suspended" })], vehicles: [veh("VD1", 8000, { depotLat: null, depotLng: null })] }));
    expect(r.rejectedCandidates.some((x) => x.code === "ADD_RESOURCE" && /مستودع/.test(x.reason))).toBe(true);
    expect(r.recommended).toBeNull();
  });
  it("explanation record and summary come from the engine's own figures", () => {
    const r = run(st({ profiles: [prof("D1"), prof("D2", { vehicleId: null })], vehicles: [veh("VD1", 2500), veh("VSPARE", 8000)] }));
    expect(r.explanation.decisionType).toBe("OPERATIONAL_ADJUSTMENT");
    expect(r.explanation.chosen.why).toContain("LOWEST_COST_VALID_IN_SCOPE");
    expect(r.explanation.chosen.why).toContain("NO_EXTRA_OR_BORROWED_RESOURCE");
    expect(r.explanation.alternatives.studied).toBe(r.search.setsEvaluated);
    expect(r.explanation.policyVersion).toMatch(/^p-/);
    const text = adjustmentSummary(r);
    expect(text).toContain("سعة المركبات غير كافية");
    expect(text).toContain(`قارن النظام ${r.search.setsEvaluated}`);
    expect(text).toContain("«تشغيل مركبة متاحة داخل البلدية»");
  });
  it("what happens if the recommendation is not adopted", () => {
    const r = run(st({ vehicles: [veh("VD1", 2500)] }));
    expect(r.ifNotAdopted.unservedBins).toBeGreaterThan(0);
    expect(r.ifNotAdopted.criticalUnserved).toBeGreaterThan(0);
  });
  it("25. the engine stops safely on an error", () => {
    const bad = st(); Object.defineProperty(bad, "bins", { get() { throw new Error("snapshot broken"); } });
    const r = run(bad);
    expect(r.status).toBe("ERROR");
  });
  it("fingerprint changes when a resource changes state (stale recommendations are detectable)", () => {
    const a = st(); const b = st({ vehicles: [veh("VD1", 8000, { status: "maintenance" })] });
    expect(stateFingerprint(a)).not.toBe(stateFingerprint(b));
    expect(stateFingerprint(a)).toBe(stateFingerprint(st()));
  });
  it("deterministic", () => {
    const s = st({ profiles: [prof("D1"), prof("D2", { vehicleId: null })], vehicles: [veh("VD1", 2500), veh("VSPARE", 8000)] });
    const a = run(s), b = run(s);
    expect(a.recommended.id).toBe(b.recommended.id);
    expect(a.alternatives.map((x) => x.id)).toEqual(b.alternatives.map((x) => x.id));
  });
});

describe("approval operations", () => {
  it("demo-labelled (simulated) drivers get real routes; only the virtual extra crew becomes an external request", async () => {
    const { buildAdjustmentOperations } = await import("../adjustmentOperations");
    const s = st({ profiles: [prof("D1", { simulated: true }), prof("D2", { vehicleId: null, simulated: true })], vehicles: [veh("VD1", 2500), veh("VSPARE", 8000)] });
    const r = run(s);
    const ops = buildAdjustmentOperations(r.recommended, s, { now: NOW, analysisId: "t" });
    expect(ops.filter((o) => o.op === "CREATE_ROUTE").length).toBeGreaterThan(0);
    expect(ops.some((o) => o.op === "EXTERNAL_REQUEST")).toBe(false);
    expect(ops.find((o) => o.op === "LINK_VEHICLE")).toMatchObject({ driverId: "D2", vehicleId: "VSPARE" });
    const add = run(st({ vehicles: [veh("VD1", 2500)] }));
    const ops2 = buildAdjustmentOperations(add.recommended, st({ vehicles: [veh("VD1", 2500)] }), { now: NOW, analysisId: "u" });
    expect(ops2.some((o) => o.op === "EXTERNAL_REQUEST")).toBe(true);
    expect(ops2.some((o) => o.op === "CREATE_ROUTE" && o.driverId === null)).toBe(false);
  });
});
