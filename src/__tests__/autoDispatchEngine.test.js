import { describe, it, expect } from "vitest";
import { planDispatch, cheapestInsertion, pendingStops, driverBlocker, actionInScope, stableHash, DEFAULT_DISPATCH_SETTINGS } from "../autoDispatchEngine";

const now = Date.now();
const fresh = new Date(now - 60000).toISOString();
const depot = { lat: 26.33, lng: 43.95 };
const neighborhoods = [{ id: "n1", name: "حي الخليج" }, { id: "n2", name: "حي الشروق" }];
const bin = (id, nid, fill, lat, lng, extra = {}) => ({ id, name: id, neighborhoodId: nid, municipalityId: "east", deviceId: "d" + id, lastFillLevelPercent: fill, lastTemperatureCelsius: 28, lastReadingAt: fresh, lat, lng, capacityLiters: 1100, demo: true, ...extra });
const k = (id, fill, i) => bin(id, "n1", fill, 26.360 + i * 0.001, 43.970 + i * 0.001);
const s = (id, fill, i) => bin(id, "n2", fill, 26.330 + i * 0.001, 44.040 + i * 0.001);
const driver = (uid, extra = {}) => ({ uid, fullName: uid, accountStatus: "active", shiftStatus: "on_shift", availability: "available", vehicleId: "V" + uid, neighborhoodKeys: ["الخليج", "الشروق"], municipalityId: "east", ...extra });
const vehicle = (id, extra = {}) => ({ id, vehicleNumber: id, status: "available", capacityLiters: 8000, depotLat: depot.lat, depotLng: depot.lng, municipalityId: "east", ...extra });
const state = (over = {}) => ({ municipalityId: "east", neighborhoods, depot, bins: [], profiles: [], vehicles: [], routes: [], incidents: [], ...over });
const byType = (plan, t) => plan.actions.filter((a) => a.type === t);

describe("grouping and assignment", () => {
  it("groups bins into ONE optimized route per neighborhood and auto-assigns an eligible driver with its reason", () => {
    const bins = [k("k1", 92, 0), k("k2", 90, 1), k("k3", 88, 2), k("k4", 20, 3)];
    const plan = planDispatch(state({ bins, profiles: [driver("D1")], vehicles: [vehicle("VD1")] }), {}, { now });
    const created = byType(plan, "create_assign");
    expect(created.length).toBe(1);
    expect(created[0].binIds.sort()).toEqual(["k1", "k2", "k3"]);            // not one route per bin; the 20% bin is not included
    expect(created[0].driverId).toBe("D1"); expect(created[0].vehicleId).toBe("VD1");
    expect(created[0].reason).toContain("D1"); expect(created[0].reason).toContain("ضمن النطاق");
    expect(created[0].route.status).toBeUndefined();                          // status is set by the runner at commit time
    expect(created[0].route.orderedStops.map((o) => o.order)).toEqual([1, 2, 3]);
  });
  it("routine grouping: too few bins are deferred, an urgent bin is dispatched immediately", () => {
    const routine = planDispatch(state({ bins: [k("k1", 88, 0)], profiles: [driver("D1")], vehicles: [vehicle("VD1")] }), {}, { now });
    expect(byType(routine, "create_assign").length).toBe(0);
    expect(byType(routine, "defer")[0].reason).toContain("الحد الأدنى");
    const urgent = planDispatch(state({ bins: [k("k1", 97, 0)], profiles: [driver("D1")], vehicles: [vehicle("VD1")] }), {}, { now });
    expect(byType(urgent, "create_assign").length).toBe(1);
    expect(byType(urgent, "create_assign")[0].urgent).toBe(true);
  });
  it("one driver, two neighborhoods: the second route is escalated (a driver never gets two concurrent routes)", () => {
    const bins = [k("k1", 92, 0), k("k2", 91, 1), k("k3", 90, 2), s("s1", 95, 0), s("s2", 93, 1), s("s3", 90, 2)];
    const plan = planDispatch(state({ bins, profiles: [driver("D1")], vehicles: [vehicle("VD1")] }), {}, { now });
    expect(byType(plan, "create_assign").length).toBe(1);
    const esc = byType(plan, "escalate").find((e) => e.kind === "no_driver");
    expect(esc).toBeTruthy(); expect(esc.suggestion).toContain("الأمانة");     // transfer stays an Amanah decision
  });
});

describe("hard operating constraints", () => {
  const bins = [k("k1", 92, 0), k("k2", 90, 1), k("k3", 88, 2)];
  it("shift, availability and vehicle state: no eligible driver → escalated, never assigned", () => {
    for (const [p, v] of [[driver("D1", { shiftStatus: "off_shift" }), vehicle("VD1")], [driver("D1", { availability: "unavailable" }), vehicle("VD1")], [driver("D1"), vehicle("VD1", { status: "maintenance" })], [driver("D1", { neighborhoodKeys: ["الأفق"] }), vehicle("VD1")]]) {
      const plan = planDispatch(state({ bins, profiles: [p], vehicles: [v] }), {}, { now });
      expect(byType(plan, "create_assign").length).toBe(0);
      expect(byType(plan, "escalate").some((e) => e.kind === "no_driver")).toBe(true);
    }
  });
  it("capacity: a load bigger than every eligible vehicle is escalated, not assigned", () => {
    const plan = planDispatch(state({ bins, profiles: [driver("D1")], vehicles: [vehicle("VD1", { capacityLiters: 1000 })] }), {}, { now });
    expect(byType(plan, "create_assign").length).toBe(0);
    expect(byType(plan, "escalate")[0].kind).toBe("capacity");
  });
  it("approach time above the limit is escalated", () => {
    const far = vehicle("VD1", { depotLat: 25.0, depotLng: 45.0 });
    const plan = planDispatch(state({ bins, depot: null, profiles: [driver("D1")], vehicles: [far] }), {}, { now });
    expect(byType(plan, "create_assign").length).toBe(0);
    expect(byType(plan, "escalate")[0].kind).toBe("too_far");
  });
  it("thermal danger and unreliable sensors on critical bins go to a human", () => {
    const hot = k("hot", 70, 5); hot.lastTemperatureCelsius = 72;
    const silent = k("silent", 96, 6); silent.lastReadingAt = new Date(now - 5 * 3600000).toISOString();
    const plan = planDispatch(state({ bins: [...bins, hot, silent], profiles: [driver("D1")], vehicles: [vehicle("VD1")] }), {}, { now });
    const kinds = byType(plan, "escalate").map((e) => e.kind);
    expect(kinds).toContain("thermal"); expect(kinds).toContain("sensor");
    const silent2 = k("silent2", 97, 7); silent2.lastReadingAt = silent.lastReadingAt;
    const grouped = planDispatch(state({ bins: [...bins, silent, silent2], profiles: [driver("D1")], vehicles: [vehicle("VD1")] }), {}, { now });
    const sensorEsc = byType(grouped, "escalate").filter((e) => e.kind === "sensor");
    expect(sensorEsc.length).toBe(1); expect(sensorEsc[0].binIds).toEqual(["silent", "silent2"]);   // one escalation per neighborhood
    const routed = byType(plan, "create_assign").flatMap((a) => a.binIds);
    expect(routed).not.toContain("hot"); expect(routed).not.toContain("silent");
  });
});

describe("insert into an existing route first", () => {
  const route = (extra = {}) => ({ id: "R1", routeName: "جولة الخليج", status: "approved", driverId: "D1", driverName: "D1", vehicleId: "VD1", neighborhoodIds: ["n1"], binIds: ["k1", "k2"], estimatedWasteLiters: 2000,
    orderedStops: [{ order: 1, binId: "k1", lat: 26.360, lng: 43.970 }, { order: 2, binId: "k2", lat: 26.362, lng: 43.972 }], ...extra });
  it("a new critical bin next to an assigned route joins it instead of creating a route", () => {
    const bins = [k("k1", 30, 0), k("k2", 30, 2), k("k9", 93, 1)];
    const plan = planDispatch(state({ bins, profiles: [driver("D1")], vehicles: [vehicle("VD1")], routes: [route()] }), {}, { now });
    expect(byType(plan, "create_assign").length).toBe(0);
    const ins = byType(plan, "insert");
    expect(ins.length).toBe(1); expect(ins[0].routeId).toBe("R1"); expect(ins[0].position).toBe(1);   // between k1 and k2
    expect(ins[0].addedMin).toBeLessThanOrEqual(DEFAULT_DISPATCH_SETTINGS.insertMaxAddedMin);
    expect(ins[0].reason).toContain("جولة الخليج");
  });
  it("no insertion when the vehicle is full, into a collected stop, or when the route's driver went off shift", () => {
    const bins = [k("k1", 30, 0), k("k2", 30, 2), k("k9", 97, 1)];
    expect(byType(planDispatch(state({ bins, profiles: [driver("D1")], vehicles: [vehicle("VD1", { capacityLiters: 2100 })], routes: [route()] }), {}, { now }), "insert").length).toBe(0);
    const done = route({ status: "in_progress", collectedBinIds: ["k1", "k2"] });
    expect(pendingStops(done).length).toBe(0);
    expect(byType(planDispatch(state({ bins, profiles: [driver("D1")], vehicles: [vehicle("VD1")], routes: [done] }), {}, { now }), "insert").length).toBe(0);
    expect(byType(planDispatch(state({ bins, profiles: [driver("D1", { shiftStatus: "off_shift" })], vehicles: [vehicle("VD1")], routes: [route()] }), {}, { now }), "insert").length).toBe(0);
  });
  it("cheapest insertion respects pending order and reports detour", () => {
    const r = route();
    const ins = cheapestInsertion(r, k("x", 90, 1));
    expect(ins.position).toBe(1); expect(ins.detourKm).toBeGreaterThanOrEqual(0); expect(ins.nearestKm).toBeLessThan(0.2);
    expect(cheapestInsertion(r, { id: "nocoords" })).toBeNull();
  });
});

describe("re-evaluation", () => {
  const bins = [k("k1", 92, 0), k("k2", 90, 1), k("k3", 88, 2)];
  const approved = (extra = {}) => ({ id: "R1", routeName: "جولة الخليج", status: "approved", driverId: "D1", driverName: "D1", vehicleId: "VD1", neighborhoodIds: ["n1"], binIds: ["k1", "k2", "k3"], estimatedWasteLiters: 3000, approvedAt: fresh,
    orderedStops: bins.map((b, i) => ({ order: i + 1, binId: b.id, lat: b.lat, lng: b.lng })), ...extra });
  it("an auto-dispatched route whose driver went off shift is reassigned to an eligible driver", () => {
    const plan = planDispatch(state({ bins, profiles: [driver("D1", { shiftStatus: "off_shift" }), driver("D2")], vehicles: [vehicle("VD1"), vehicle("VD2")], routes: [approved({ dispatch: { auto: true } })] }), {}, { now });
    const rea = byType(plan, "reassign");
    expect(rea.length).toBe(1); expect(rea[0].driverId).toBe("D2"); expect(rea[0].reason).toContain("خارج المناوبة");
    expect(byType(plan, "create_assign").length).toBe(0);                    // its bins stay locked on the route
  });
  it("a HUMAN-assigned route is never changed automatically — escalated with the suggested replacement", () => {
    const plan = planDispatch(state({ bins, profiles: [driver("D1", { availability: "unavailable" }), driver("D2")], vehicles: [vehicle("VD1"), vehicle("VD2")], routes: [approved()] }), {}, { now });
    expect(byType(plan, "reassign").length).toBe(0);
    const esc = byType(plan, "escalate").find((e) => e.kind === "driver_unavailable");
    expect(esc.reason).toContain("إسناد بشري"); expect(esc.suggestion).toContain("D2");
  });
  it("no replacement for an auto route → released back to suggested + escalated; stale approval and broken vehicle escalate", () => {
    const plan = planDispatch(state({ bins, profiles: [driver("D1", { shiftStatus: "off_shift" })], vehicles: [vehicle("VD1")], routes: [approved({ dispatch: { auto: true } })] }), {}, { now });
    expect(byType(plan, "release").length).toBe(1);
    expect(byType(plan, "escalate").some((e) => e.kind === "driver_unavailable")).toBe(true);
    const stale = planDispatch(state({ bins, profiles: [driver("D1")], vehicles: [vehicle("VD1")], routes: [approved({ approvedAt: new Date(now - 3 * 3600000).toISOString() })] }), {}, { now });
    expect(byType(stale, "escalate")[0].kind).toBe("not_started");
    const running = planDispatch(state({ bins, profiles: [driver("D1")], vehicles: [vehicle("VD1", { status: "maintenance" })], routes: [approved({ status: "in_progress" })] }), {}, { now });
    expect(byType(running, "escalate")[0].kind).toBe("vehicle_down");
    expect(driverBlocker(approved(), { profiles: [driver("D1")], vehicles: [vehicle("VD1", { status: "offline" })] })).toContain("غير متصلة");
  });
});

describe("idempotency and scope", () => {
  const bins = [k("k1", 92, 0), k("k2", 90, 1), k("k3", 88, 2)];
  it("same input → same keys; a new collection cycle → a new key", () => {
    const st = () => state({ bins: bins.map((b) => ({ ...b })), profiles: [driver("D1")], vehicles: [vehicle("VD1")] });
    const a = planDispatch(st(), {}, { now }).actions.map((x) => x.key);
    const b = planDispatch(st(), {}, { now }).actions.map((x) => x.key);
    expect(a).toEqual(b);
    const collected = state({ bins: bins.map((x) => ({ ...x, lastCollectionAt: "2026-10-12T08:00:00.000Z" })), profiles: [driver("D1")], vehicles: [vehicle("VD1")] });
    expect(planDispatch(collected, {}, { now }).actions[0].key).not.toBe(a[0]);
    expect(stableHash("abc")).toBe(stableHash("abc")); expect(stableHash("abc")).not.toBe(stableHash("abd"));
  });
  it("demo_only scope executes only actions whose bins are all demo bins", () => {
    const m = new Map([["a", { id: "a", demo: true }], ["b", { id: "b" }], ["c", { id: "c", simulated: true }]]);
    expect(actionInScope({ binIds: ["a", "c"] }, m, "demo_only")).toBe(true);
    expect(actionInScope({ binIds: ["a", "b"] }, m, "demo_only")).toBe(false);
    expect(actionInScope({ binIds: ["b"] }, m, "all")).toBe(true);
    expect(actionInScope({ binIds: [] }, m, "demo_only")).toBe(false);
  });
});
