import { describe, it, expect, vi } from "vitest";
import { distanceM, bearingDeg, formatDistanceAr, instructionAr, parseSteps, projectOnRoute, nextManeuver, offRouteDecision, arrivedAtStop, fixQuality, shouldPersistLocation } from "../navigation";
import { collectionEventId, canConfirmCollection, routeProgress, nextStopFor, skipEntry, reinstateSkippedStop, buildConfirmation, INCIDENT_TYPES } from "../executionEngine";
import { createOfflineQueue } from "../offlineQueue";

// A straight street heading east from (26.36, 43.90), 1 km ≈ 0.01° lng here.
const P = (km, latOff = 0) => ({ lat: 26.36 + latOff, lng: 43.90 + km * 0.01 });
const coords = [0, 0.5, 1, 1.5, 2].map((k) => [P(k).lat, P(k).lng]);

describe("navigation — geometry", () => {
  it("distance and bearing", () => {
    expect(distanceM(P(0), P(1))).toBeGreaterThan(900);
    expect(distanceM(P(0), P(1))).toBeLessThan(1100);
    expect(Math.round(bearingDeg(P(0), P(1)))).toBeCloseTo(90, -1);
    expect(formatDistanceAr(187)).toBe("190 متر");
    expect(formatDistanceAr(1240)).toBe("1.2 كم");
  });
  it("projects onto the route with off-route distance and remaining distance", () => {
    const onRoad = projectOnRoute(P(1), coords);
    expect(onRoad.distanceM).toBeLessThan(5);
    expect(onRoad.remainingM).toBeGreaterThan(900);
    expect(onRoad.remainingM).toBeLessThan(1100);
    const off = projectOnRoute(P(1, 0.002), coords); // ~220 m north of the street
    expect(off.distanceM).toBeGreaterThan(150);
    expect(projectOnRoute(P(1), []).distanceM).toBe(Infinity);
  });
  it("Arabic instructions from OSRM maneuvers", () => {
    expect(instructionAr({ maneuver: { type: "turn", modifier: "right" }, name: "طريق الملك عبدالعزيز" })).toBe("انعطف يمينًا إلى طريق الملك عبدالعزيز");
    expect(instructionAr({ maneuver: { type: "turn", modifier: "straight" } })).toBe("تابع مستقيمًا");
    expect(instructionAr({ maneuver: { type: "arrive" } })).toBe("وصلت إلى الحاوية التالية");
    expect(instructionAr({ maneuver: { type: "roundabout", exit: 2 } })).toContain("المخرج 2");
  });
  it("parses steps and finds the next maneuver ahead of the driver", () => {
    const osrm = { legs: [{ steps: [
      { maneuver: { type: "depart", location: [P(0).lng, P(0).lat] }, distance: 1000, duration: 120, name: "" },
      { maneuver: { type: "turn", modifier: "left", location: [P(1).lng, P(1).lat] }, distance: 1000, duration: 120, name: "شارع 1" },
      { maneuver: { type: "arrive", location: [P(2).lng, P(2).lat] }, distance: 0, duration: 0, name: "" },
    ] }] };
    const steps = parseSteps(osrm);
    expect(steps.length).toBe(3);
    const nm = nextManeuver(P(0.4), steps, coords);
    expect(nm.text).toContain("انعطف يسارًا");
    expect(nm.distanceToM).toBeGreaterThan(500);
    expect(nm.distanceToM).toBeLessThan(700);
    expect(nextManeuver(P(1.5), steps, coords).type).toBe("arrive");
    expect(nextManeuver(P(0.4), [], coords)).toBeNull();
  });
  it("off-route needs consecutive bad fixes and respects GPS accuracy", () => {
    const good = { distanceM: 10, accuracyM: 15 };
    const bad = { distanceM: 120, accuracyM: 15 };
    const noisy = { distanceM: 120, accuracyM: 100 }; // 1.5×100 = 150 > 120 → tolerated
    expect(offRouteDecision([bad, bad]).offRoute).toBe(false);
    expect(offRouteDecision([good, bad, bad, bad]).offRoute).toBe(true);
    expect(offRouteDecision([bad, bad, good]).offRoute).toBe(false);
    expect(offRouteDecision([noisy, noisy, noisy]).offRoute).toBe(false);
  });
  it("arrival radius grows with poor accuracy but is capped; fix quality labels", () => {
    const stop = P(1);
    expect(arrivedAtStop(P(1.02), stop, { accuracyM: 10 })).toBe(true);   // ~20 m
    expect(arrivedAtStop(P(1.06), stop, { accuracyM: 10 })).toBe(false);  // ~60 m
    expect(arrivedAtStop(P(1.06), stop, { accuracyM: 70 })).toBe(true);   // radius 70
    expect(arrivedAtStop(P(1.1), stop, { accuracyM: 500 })).toBe(false);  // ~100 m, radius capped at 80
    expect(fixQuality(8).level).toBe("good");
    expect(fixQuality(150).label).toContain("ضعيفة");
  });
  it("location persistence throttle", () => {
    const t0 = new Date("2026-10-11T06:00:00Z").toISOString();
    const t1 = new Date("2026-10-11T06:00:10Z").toISOString();
    const t2 = new Date("2026-10-11T06:00:30Z").toISOString();
    expect(shouldPersistLocation(null, { ...P(0), at: t0 })).toBe(true);
    expect(shouldPersistLocation({ ...P(0), at: t0 }, { ...P(0.01), at: t1 })).toBe(false); // 10 m, 10 s
    expect(shouldPersistLocation({ ...P(0), at: t0 }, { ...P(0.01), at: t2 })).toBe(true);  // 30 s
    expect(shouldPersistLocation({ ...P(0), at: t0 }, { ...P(0.1), at: t1 })).toBe(true);   // 100 m
  });
});

describe("execution — confirmation, idempotency, skips", () => {
  const user = { uid: "D1", name: "أحمد", role: "driver" };
  const route = { id: "R1", status: "in_progress", driverId: "D1", vehicleId: "V1", binIds: ["b1", "b2", "b3"], orderedStops: [{ binId: "b1", binName: "1" }, { binId: "b2", binName: "2" }, { binId: "b3", binName: "3" }], collectedBinIds: ["b1"], skippedStops: [{ binId: "b2", reason: "obstacle" }] };
  it("deterministic event id makes a double tap idempotent", () => {
    expect(collectionEventId("R1", "b1")).toBe(collectionEventId("R1", "b1"));
    expect(collectionEventId("R1", "b1")).not.toBe(collectionEventId("R1", "b2"));
  });
  it("authorization: only the assigned driver, only an active route, only bins in it, never twice", () => {
    expect(canConfirmCollection({ user, route, binId: "b3" }).ok).toBe(true);
    expect(canConfirmCollection({ user: { ...user, uid: "D2" }, route, binId: "b3" }).reason).toContain("غير مسندة لك");
    expect(canConfirmCollection({ user, route: { ...route, status: "approved" }, binId: "b3" }).reason).toContain("ليست نشطة");
    expect(canConfirmCollection({ user, route, binId: "zzz" }).reason).toContain("ليست ضمن");
    expect(canConfirmCollection({ user, route, binId: "b1" }).reason).toContain("مسبقًا");
  });
  it("progress keeps collected and skipped separate; next stop skips both", () => {
    const p = routeProgress(route);
    expect(p).toMatchObject({ total: 3, collected: 1, skipped: 1, remaining: 1, pct: 33, done: false });
    expect(nextStopFor(route).binId).toBe("b3");
    expect(routeProgress({ ...route, collectedBinIds: ["b1", "b3"] }).done).toBe(true);
  });
  it("skip entries carry the reason and can be reinstated", () => {
    const e = skipEntry({ binId: "b3", type: "unreachable", incidentId: "I1", note: "بوابة مغلقة" });
    expect(e.reason).toBe("unreachable");
    expect(() => skipEntry({ binId: "b3", type: "nope" })).toThrow();
    expect(reinstateSkippedStop(route, "b2").skippedStops).toEqual([]);
    expect(Object.keys(INCIDENT_TYPES)).toEqual(["obstacle", "fault", "unreachable"]);
  });
  it("confirmation records time, location+accuracy and never fabricates a new fill reading", () => {
    const c = buildConfirmation({ route, bin: { id: "b3", lat: 26.36, lng: 43.92, lastFillLevelPercent: 91 }, user, position: { lat: 26.3601, lng: 43.92, accuracy: 12 } });
    expect(c.id).toBe("R1__b3");
    expect(c.fillBefore).toBe(91);
    expect(c.fillAfter).toBeNull();
    expect(c.confirmLocation.accuracyM).toBe(12);
    expect(c.distanceToBinM).toBeLessThan(20);
    expect(c.driverId).toBe("D1");
  });
});

describe("offline queue", () => {
  const mem = () => { const m = {}; return { getItem: (k) => m[k] ?? null, setItem: (k, v) => { m[k] = v; } }; };
  it("collapses duplicates, persists, flushes in order and stops at the first failure", async () => {
    const storage = mem();
    const q = createOfflineQueue({ storage });
    q.enqueue({ id: "R1__b1", type: "collect", payload: 1 });
    q.enqueue({ id: "R1__b1", type: "collect", payload: 2 }); // same id → one entry
    q.enqueue({ id: "inc-1", type: "incident" });
    q.enqueue({ id: "R1__b2", type: "collect" });
    expect(q.size()).toBe(3);
    expect(createOfflineQueue({ storage }).size()).toBe(3); // persisted
    const handler = vi.fn(async (op) => { if (op.id === "inc-1") throw new Error("net"); });
    const r = await q.flush(handler);
    expect(r).toEqual({ sent: 1, failed: 1, pending: 2 });
    expect(q.list()[0].id).toBe("inc-1");
    expect(q.list()[0].attempts).toBe(1);
    const r2 = await q.flush(async () => {});
    expect(r2.pending).toBe(0);
    expect(() => q.enqueue({})).toThrow();
  });
});
