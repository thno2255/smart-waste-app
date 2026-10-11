/**
 * Phase 6 — integration of the pure engines across one route's lifecycle:
 * assign → start → navigate → confirm → incident/skip → reinstate → complete,
 * plus a performance budget for the optimizer and assignment ranking.
 * (Firestore rules are covered separately by tests/rules on the emulator.)
 */
import { describe, it, expect } from "vitest";
import { can, eligibleDriversFor, findRouteAssignmentConflicts } from "../fleetEngine";
import { rankDriverCandidates } from "../assignmentEngine";
import { optimizeRoute } from "../routeOptimizer";
import { canConfirmCollection, routeProgress, nextStopFor, skipEntry, reinstateSkippedStop, buildConfirmation, collectionEventId } from "../executionEngine";
import { projectOnRoute, offRouteDecision, arrivedAtStop } from "../navigation";
import { createOfflineQueue } from "../offlineQueue";

const base = { accountStatus: "active", shiftStatus: "on_shift", availability: "available", neighborhoodKeys: ["الخليج"] };
const driver = { ...base, uid: "D1", fullName: "أحمد", vehicleId: "V1" };
const vehicles = [{ id: "V1", vehicleNumber: "مركبة 1", status: "available", capacityLiters: 6000, depotLat: 26.33, depotLng: 43.95 }];
const mk = (i) => ({ binId: `b${i}`, binName: `حاوية ${i}`, lat: 26.36 + (i % 3) * 0.004, lng: 43.96 + Math.floor(i / 3) * 0.004, priorityTier: i === 2 ? "critical" : "high", priorityScore: i === 2 ? 95 : 70, wasteLiters: 900 });
const user = { uid: "D1", name: "أحمد", role: "driver" };

describe("route lifecycle across engines", () => {
  it("runs end-to-end with consistent state", async () => {
    // 1. suggested route → assignment recommendation → approve to the recommended driver
    let route = { id: "R1", routeName: "جولة الخليج", status: "suggested", binIds: ["b0", "b1", "b2", "b3"], orderedStops: [0, 1, 2, 3].map(mk), estimatedDistanceKm: 3, estimatedWasteLiters: 3600 };
    const rec = rankDriverCandidates(route, { profiles: [driver], vehicles, routes: [route], neighborhoodName: "الخليج" });
    expect(rec.recommended.driverId).toBe("D1");
    expect(findRouteAssignmentConflicts({ routeId: "R1", driverId: "D1", vehicleId: "V1" }, [route])).toEqual([]);
    route = { ...route, status: "approved", driverId: "D1", vehicleId: "V1" };

    // 2. optimize the order (capacity ok, priority pulls b2 forward)
    const opt = optimizeRoute({ start: { lat: 26.33, lng: 43.95 }, stops: route.orderedStops, capacityLiters: 6000 });
    expect(opt.ok).toBe(true);
    expect(opt.deferredStops).toEqual([]);
    route = { ...route, orderedStops: opt.orderedStops.filter((o) => o.type === "stop").map((o, i) => ({ ...o, order: i + 1 })) };

    // 3. driver starts (authorized), navigates; off-route needs 3 bad fixes
    expect(can("driver", "routes.execute", { assignedToMe: route.driverId === user.uid })).toBe(true);
    route = { ...route, status: "in_progress", collectedBinIds: [], skippedStops: [] };
    const path = route.orderedStops.map((s) => [s.lat, s.lng]);
    expect(projectOnRoute({ lat: path[0][0], lng: path[0][1] }, path).distanceM).toBeLessThan(1);
    expect(offRouteDecision([{ distanceM: 500, accuracyM: 10 }, { distanceM: 500, accuracyM: 10 }, { distanceM: 500, accuracyM: 10 }]).offRoute).toBe(true);

    // 4. confirm first stop at its location (idempotent id), progress updates
    const first = nextStopFor(route);
    expect(arrivedAtStop({ lat: first.lat, lng: first.lng }, first, { accuracyM: 8 })).toBe(true);
    expect(canConfirmCollection({ user, route, binId: first.binId }).ok).toBe(true);
    const conf = buildConfirmation({ route, bin: { id: first.binId, lat: first.lat, lng: first.lng, lastFillLevelPercent: 88 }, user, position: { lat: first.lat, lng: first.lng, accuracy: 8 } });
    expect(conf.id).toBe(collectionEventId("R1", first.binId));
    expect(conf.fillAfter).toBeNull();
    route = { ...route, collectedBinIds: [first.binId] };
    expect(canConfirmCollection({ user, route, binId: first.binId }).ok).toBe(false); // second tap rejected
    expect(routeProgress(route).collected).toBe(1);

    // 5. obstacle on the next stop → skipped (not collected) → manager reinstates
    const second = nextStopFor(route);
    route = { ...route, skippedStops: [skipEntry({ binId: second.binId, type: "obstacle", incidentId: "I1" })] };
    expect(routeProgress(route)).toMatchObject({ collected: 1, skipped: 1, remaining: 2 });
    expect(nextStopFor(route).binId).not.toBe(second.binId);
    route = { ...route, ...reinstateSkippedStop(route, second.binId) };
    expect(nextStopFor(route).binId).toBe(second.binId);

    // 6. offline: a confirmation queued and replayed exactly once
    const storage = (() => { const m = {}; return { getItem: (k) => m[k] ?? null, setItem: (k, v) => { m[k] = v; } }; })();
    const q = createOfflineQueue({ storage });
    q.enqueue({ id: conf.id, type: "collect", payload: conf });
    q.enqueue({ id: conf.id, type: "collect", payload: conf });
    const sent = [];
    await q.flush(async (op) => sent.push(op.id));
    expect(sent).toEqual([conf.id]);

    // 7. finish: all remaining collected → done
    for (const s of routeProgress(route).remainingStops) route = { ...route, collectedBinIds: [...route.collectedBinIds, s.binId] };
    expect(routeProgress(route).done).toBe(true);
  });

  it("no eligible driver → recommendation null and exceptional assignment is the only path", () => {
    const off = { ...driver, shiftStatus: "off_shift" };
    const route = { id: "R", status: "suggested", binIds: ["b0"], orderedStops: [mk(0)], estimatedWasteLiters: 900 };
    expect(eligibleDriversFor("الخليج", { profiles: [off], vehicles, routes: [] })[0].eligible).toBe(false);
    expect(rankDriverCandidates(route, { profiles: [off], vehicles, routes: [], neighborhoodName: "الخليج" }).recommended).toBeNull();
  });
});

describe("performance budgets", () => {
  it("optimizes 40 stops under 1.5 s and ranks 200 drivers under 100 ms", () => {
    const stops = Array.from({ length: 40 }, (_, i) => ({ binId: `s${i}`, binName: `s${i}`, lat: 26.3 + Math.sin(i * 1.7) * 0.03, lng: 43.9 + Math.cos(i * 2.3) * 0.03, priorityTier: i % 7 === 0 ? "critical" : "high", priorityScore: 60, wasteLiters: 100 }));
    const t0 = performance.now();
    const r = optimizeRoute({ start: { lat: 26.3, lng: 43.9 }, stops, capacityLiters: 60000 });
    const dt = performance.now() - t0;
    expect(r.ok).toBe(true);
    expect(r.orderedStops.length).toBe(40);
    expect(dt).toBeLessThan(1500);

    const profiles = Array.from({ length: 200 }, (_, i) => ({ ...base, uid: `D${i}`, fullName: `س${i}`, vehicleId: "V1" }));
    const route = { id: "R", status: "suggested", binIds: ["b0"], orderedStops: [mk(0)], estimatedWasteLiters: 900 };
    const t1 = performance.now();
    const rec = rankDriverCandidates(route, { profiles, vehicles, routes: [], neighborhoodName: "الخليج" });
    expect(rec.candidates.length).toBe(200);
    expect(performance.now() - t1).toBeLessThan(100);
  });
});
