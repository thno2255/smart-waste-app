/**
 * Regression tests for the four operational defects found by the Codex review of 704311d.
 *   1. a multi-bin decision is not "succeeded" after one collection
 *   2. no adjustment is "feasible" before capacity, load, drive + service, start, shift end, dump, return and commitments are checked
 *   3. savings keep their sign: degradation is shown, missing data is null, never 0
 *   4. inter-municipality loans are consistent as a set: no resource for two municipalities, time windows, donor checked
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { decisionExecution, summarizeExecutions } from "../executionOutcome";
import { operationalImpact, expectedRouteImpact } from "../decisionExplain";
import { compareDistance, deltaText, OUTCOME } from "../savings";
import { planDispatch } from "../autoDispatchEngine";
import { analyzeResourceGaps } from "../resourceGapEngine";
import { municipalityPressure, recommendTransfers } from "../interMunicipalEngine";
import { findReservationConflicts, windowsOverlap } from "../resourceReservations";

const now = Date.UTC(2026, 9, 13, 9, 0, 0); // 12:00 local (UTC+3)
beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now); });
afterAll(() => { vi.useRealTimers(); });
const iso = (ms) => new Date(ms).toISOString();
const fresh = iso(now - 60000);

// ── 1. execution outcome ──
describe("fix 1 — a decision is completed only when ALL its bins are collected on ITS route", () => {
  const decision = { id: "d1", status: "executed", type: "create_assign", routeId: "R1", binIds: ["a", "b", "c"], urgent: true, executedAt: iso(now - 90 * 60000), expectedCollectionAt: iso(now - 30 * 60000) };
  const route = (extra = {}) => ({ id: "R1", status: "in_progress", binIds: ["a", "b", "c"], orderedStops: [], ...extra });
  const ev = (binId, minAfter, routeId = "R1") => ({ routeId, binId, confirmedAt: iso(now - 90 * 60000 + minAfter * 60000) });
  const ctx = (routes, events) => ({ routes, events, now, criticalCollectionMin: 60 });

  it("one of three collected → PARTIAL (not completed)", () => {
    expect(decisionExecution(decision, ctx([route()], [ev("a", 10)])).state).toBe("DELAYED"); // deadline passed, still open
    const fresh = { ...decision, executedAt: iso(now - 10 * 60000) };
    expect(decisionExecution(fresh, ctx([route()], [ev("a", 85)])).state).toBe("PARTIAL");
  });
  it("all collected within the deadline → COMPLETED_ON_TIME; after → COMPLETED_LATE", () => {
    expect(decisionExecution(decision, ctx([route({ status: "completed" })], [ev("a", 10), ev("b", 20), ev("c", 30)])).state).toBe("COMPLETED_ON_TIME");
    expect(decisionExecution(decision, ctx([route({ status: "completed" })], [ev("a", 10), ev("b", 20), ev("c", 75)])).state).toBe("COMPLETED_LATE");
  });
  it("an event on ANOTHER route for the same bin does not count", () => {
    const x = decisionExecution(decision, ctx([route({ status: "completed" })], [ev("a", 10), ev("b", 20), ev("c", 30, "OTHER")]));
    expect(x.state).toBe("PARTIAL"); expect(x.collected).toBe(2);
  });
  it("route ended with nothing collected → FAILED; every bin skipped → FAILED", () => {
    expect(decisionExecution(decision, ctx([route({ status: "completed" })], [])).state).toBe("FAILED");
    expect(decisionExecution(decision, ctx([route({ skippedStops: [{ binId: "a" }, { binId: "b" }, { binId: "c" }] })], [])).state).toBe("FAILED");
  });
  it("not started / started / unknown route", () => {
    const later = { ...decision, executedAt: iso(now - 5 * 60000), expectedCollectionAt: iso(now + 30 * 60000) };
    expect(decisionExecution(later, ctx([route({ status: "approved" })], [])).state).toBe("NOT_STARTED");
    expect(decisionExecution(later, ctx([route()], [])).state).toBe("STARTED");
    expect(decisionExecution(later, ctx([], [])).state).toBe("UNKNOWN");
  });
  it("operationalImpact counts a 3-bin decision with 1 collection as NOT succeeded", () => {
    const routes = [route({ status: "completed", completedAt: iso(now - 5 * 60000), approvedAt: iso(now - 90 * 60000) })];
    const r = operationalImpact({ routes, events: [ev("a", 10)], decisions: [decision], vehicles: [], targets: { criticalCollectionMin: 60 }, from: now - 86400000, to: now }).realised;
    expect(r.autoDecisionsExecuted).toBe(1);
    expect(r.autoDecisionsSucceeded).toBe(0);
    expect(r.autoDecisionsByState.PARTIAL).toBe(1);
    const all = operationalImpact({ routes, events: [ev("a", 10), ev("b", 20), ev("c", 30)], decisions: [decision], vehicles: [], targets: { criticalCollectionMin: 60 }, from: now - 86400000, to: now }).realised;
    expect(all.autoDecisionsSucceeded).toBe(1); expect(all.autoDecisionsOnTime).toBe(1);
  });
  it("summary counts by state", () => {
    const s = summarizeExecutions([decision, { ...decision, id: "d2", routeId: "R2" }], ctx([route({ status: "completed" })], [ev("a", 1), ev("b", 2), ev("c", 3)]));
    expect(s.completed).toBe(1); expect(s.byState.UNKNOWN).toBe(1);
  });
});

// ── 2. unified feasibility for the shift-timing option ──
describe("fix 2 — shift-timing is feasible only after the unified check", () => {
  const nb = [{ id: "n1", name: "حي الخليج" }];
  const bins = [["k1", 92], ["k2", 90], ["k3", 88]].map(([id, f], i) => ({ id, name: id, neighborhoodId: "n1", municipalityId: "east", lastFillLevelPercent: f, lastTemperatureCelsius: 28, lastReadingAt: fresh, lat: 26.36 + i * 0.001, lng: 43.97 + i * 0.001, capacityLiters: 1100, demo: true }));
  const offShift = (shiftStart, shiftEnd, extra = {}) => ({ uid: "D9", fullName: "سائق المناوبة التالية", accountStatus: "active", shiftStatus: "off_shift", availability: "available", vehicleId: "V9", neighborhoodKeys: ["الخليج"], municipalityId: "east", shiftStart, shiftEnd, ...extra });
  const veh = (cap) => ({ id: "V9", vehicleNumber: "V9", status: "available", capacityLiters: cap, depotLat: 26.33, depotLng: 43.95, municipalityId: "east" });
  const gapFor = (profile, vehicle) => {
    const st = { municipalityId: "east", neighborhoods: nb, depot: { lat: 26.33, lng: 43.95 }, bins, profiles: [profile], vehicles: [vehicle], routes: [], incidents: [] };
    const plan = planDispatch(st, {}, { now });
    return analyzeResourceGaps(st, plan, {}, { now }).gaps[0].gap.options.find((o) => o.code === "SHIFT_TIMING");
  };
  it("feasible when the vehicle, the shift and the time fit", () => {
    const o = gapFor(offShift("12:20", "20:00"), veh(8000));
    expect(o.feasible).toBe(true);
    expect(o.expected.afterMin).toBeGreaterThanOrEqual(20); // starts at the shift start, never earlier
  });
  it("NOT feasible when the vehicle cannot take the load (no dump site defined)", () => {
    const o = gapFor(offShift("12:20", "20:00"), veh(1500));
    expect(o.feasible).toBe(false);
    expect(o.cause).toMatch(/سعة المركبة/);
    expect(o.feasibilityCheck.violations).toContain("VEHICLE_CAPACITY");
  });
  it("NOT feasible when the shift ends before the work is done", () => {
    const o = gapFor(offShift("12:20", "12:30"), veh(8000));
    expect(o.feasible).toBe(false);
    expect(o.feasibilityCheck.violations).toContain("SHIFT_END");
  });
  it("NOT feasible when the capacity is unknown (never assumed fine)", () => {
    const o = gapFor(offShift("12:20", "20:00"), veh(null));
    expect(o.feasible).toBe(false);
    expect(o.feasibilityCheck.missing).toContain("CAPACITY_UNKNOWN");
  });
});

// ── 3. signed savings ──
describe("fix 3 — savings keep their sign; missing data is null, not 0", () => {
  it("classification and text", () => {
    expect(compareDistance(10, 8).outcome).toBe(OUTCOME.SAVING);
    expect(compareDistance(8, 10)).toMatchObject({ deltaKm: -2, outcome: OUTCOME.INCREASE });
    expect(compareDistance(8, 8.01).outcome).toBe(OUTCOME.NO_CHANGE);
    expect(compareDistance(null, 8)).toMatchObject({ deltaKm: null, outcome: OUTCOME.UNAVAILABLE });
    expect(deltaText(-2.5)).toBe(`زيادة ${(2.5).toLocaleString("ar-SA")} كم`);
    expect(deltaText(null)).toBe("غير متاح");
  });
  it("a planned route longer than its reference shows an INCREASE with negative fuel", () => {
    const start = { lat: 26.30, lng: 43.90 };
    // Reference = far → mid → near; the planned order far → near → mid doubles back, so it is longer by construction.
    const stops = [{ binId: "far", lat: 26.30, lng: 43.99, priorityScore: 9 }, { binId: "near", lat: 26.31, lng: 43.91, priorityScore: 1 }, { binId: "mid", lat: 26.305, lng: 43.95, priorityScore: 5 }];
    const imp = expectedRouteImpact(start, stops, { fuelLitersPerKm: 0.35, co2KgPerLiter: 2.68 });
    expect(imp.routeKm).toBeGreaterThan(imp.referenceKm);
    expect(imp.kmSaved).toBeLessThan(0);
    expect(imp.outcome).toBe("INCREASE");
    expect(imp.fuelL).toBeLessThan(0);
  });
  it("realised degradation is reported, not clamped to 0", () => {
    const vehicles = [{ id: "V", depotLat: 26.30, depotLng: 43.90, capacityLiters: 8000 }];
    const stops = [{ binId: "x", lat: 26.30, lng: 43.99, priorityScore: 9 }, { binId: "y", lat: 26.31, lng: 43.91, priorityScore: 1 }];
    const routes = [{ id: "R", status: "completed", vehicleId: "V", completedAt: iso(now - 60000), approvedAt: iso(now - 3600000), orderedStops: stops }];
    // Executed order: y then x then — reference: x (urgent) first. Confirm y first, then x.
    const events = [{ routeId: "R", binId: "y", confirmedAt: iso(now - 50 * 60000), fillBefore: 50 }, { routeId: "R", binId: "x", confirmedAt: iso(now - 20 * 60000), fillBefore: 90 }];
    const r = operationalImpact({ routes, events, decisions: [], vehicles, from: now - 86400000, to: now }).realised;
    expect(r.distance.basis).toBe("realised_haversine");
    expect(Math.sign(r.kmSaved)).toBe(Math.sign(r.referenceKm - r.distanceKm));
    expect(r.financial.value).toBeNull();
  });
});

// ── 4. loans consistent as a set ──
describe("fix 4 — no crew for two municipalities; loans hold a time window; the donor is protected", () => {
  const M = { north: { id: "north", shortAr: "الشمال" }, south: { id: "south", shortAr: "الجنوب" }, east: { id: "east", shortAr: "الشرق" } };
  const drv = (uid, mid, extra = {}) => ({ uid, fullName: uid, municipalityId: mid, shiftStatus: "on_shift", availability: "available", vehicleId: "V" + uid, ...extra });
  const vh = (id, mid) => ({ id, vehicleNumber: id, status: "available", capacityLiters: 6000, municipalityId: mid });
  const crit = (n, mid) => Array.from({ length: n }, (_, i) => ({ id: `${mid}${i}`, lastFillLevelPercent: 95, municipalityId: mid }));
  const centroids = { north: { lat: 26.40, lng: 43.95 }, south: { lat: 26.30, lng: 43.97 }, east: { lat: 26.35, lng: 44.02 } };
  const press = (m, live) => municipalityPressure(m, live, { now });
  it("two shortages, one donor with ONE spare crew → it is allocated once", () => {
    const north = press(M.north, { bins: crit(30, "north"), profiles: [], vehicles: [], routes: [] });
    const south = press(M.south, { bins: crit(25, "south"), profiles: [], vehicles: [], routes: [] });
    const east = press(M.east, { bins: [], profiles: [drv("e1", "east"), drv("e2", "east")], vehicles: [vh("Ve1", "east"), vh("Ve2", "east")], routes: [] });
    const r = recommendTransfers([north, south, east], { centroids, now, donorCeiling: 100 });
    const ids = r.recommendations.flatMap((x) => x.resourceIds);
    expect(new Set(ids).size).toBe(ids.length);             // no resource twice
    expect(r.conflicts).toEqual([]);
    for (const x of r.recommendations) { expect(x.window.endAt > x.window.startAt).toBe(true); expect(x.reservation.resourceIds.length).toBeGreaterThan(0); }
  });
  it("donor with critical bins keeps its last crew", () => {
    const north = press(M.north, { bins: crit(30, "north"), profiles: [], vehicles: [], routes: [] });
    const east = press(M.east, { bins: crit(1, "east"), profiles: [drv("e1", "east")], vehicles: [vh("Ve1", "east")], routes: [] });
    const r = recommendTransfers([north, east], { centroids, now, donorCeiling: 100 });
    expect(r.recommendations.length).toBe(0);
    expect(r.warnings.join(" ")).toMatch(/آخر طاقم/);
  });
  it("a resource with an overlapping active reservation is not offered again", () => {
    const north = press(M.north, { bins: crit(30, "north"), profiles: [], vehicles: [], routes: [] });
    const east = press(M.east, { bins: [], profiles: [drv("e1", "east")], vehicles: [vh("Ve1", "east")], routes: [] });
    const existing = [{ resourceId: "e1", startAt: iso(now - 600000), endAt: iso(now + 3 * 3600000), status: "active" }, { resourceId: "Ve1", startAt: iso(now - 600000), endAt: iso(now + 3 * 3600000), status: "active" }];
    const r = recommendTransfers([north, east], { centroids, now, donorCeiling: 100, existingReservations: existing });
    expect(r.recommendations.length).toBe(0);
  });
  it("a lent driver whose shift ends before the return is rejected", () => {
    const north = press(M.north, { bins: crit(30, "north"), profiles: [], vehicles: [], routes: [] });
    const east = press(M.east, { bins: [], profiles: [drv("e1", "east", { shiftStart: "06:00", shiftEnd: "13:00" })], vehicles: [vh("Ve1", "east")], routes: [] });
    const r = recommendTransfers([north, east], { centroids, now, donorCeiling: 100, loanDurationMin: 240 });
    expect(r.recommendations.filter((x) => x.driverId === "e1").length).toBe(0);
  });
  it("window overlap / conflicts helper", () => {
    expect(windowsOverlap({ startAt: 0, endAt: 10 }, { startAt: 10, endAt: 20 })).toBe(false);
    expect(windowsOverlap({ startAt: 0, endAt: 11 }, { startAt: 10, endAt: 20 })).toBe(true);
    expect(findReservationConflicts([{ resourceIds: ["d1"], startAt: 0, endAt: 10 }, { resourceIds: ["d1"], startAt: 5, endAt: 15 }]).length).toBe(1);
  });
});
