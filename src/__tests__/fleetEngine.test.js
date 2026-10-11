import { describe, it, expect } from "vitest";
import {
  can, PERMISSION_ACTIONS, driverCodeFor, validateDriverProfile, windowsOverlap,
  findVehicleAssignmentConflicts, activeAssignmentFor, vehicleHolderAt,
  findRouteAssignmentConflicts, driversCovering, coverageMatrix, eligibleDriversFor, locationFreshness,
} from "../fleetEngine";

const H = 3600000;
const t0 = Date.parse("2026-10-11T06:00:00Z");
const iso = (ms) => new Date(ms).toISOString();

describe("RBAC — can()", () => {
  it("employees/executives manage drivers, routes, vehicles; citizens never", () => {
    for (const a of ["drivers.manage", "routes.approve", "vehicles.manage", "fleet.monitor"]) {
      expect(can("employee", a)).toBe(true);
      expect(can("executive", a)).toBe(true);
      expect(can("citizen", a)).toBe(false);
      expect(can("driver", a)).toBe(false);
    }
  });
  it("drivers see/execute only routes assigned to them", () => {
    expect(can("driver", "routes.view", { assignedToMe: true })).toBe(true);
    expect(can("driver", "routes.view", { assignedToMe: false })).toBe(false);
    expect(can("driver", "routes.execute", { assignedToMe: true })).toBe(true);
    expect(can("driver", "routes.execute", {})).toBe(false);
    expect(can("driver", "routes.approve")).toBe(false);
  });
  it("a driver updates only their own profile; roles are executive-only", () => {
    expect(can("driver", "driver.self.update", { isSelf: true })).toBe(true);
    expect(can("driver", "driver.self.update", { isSelf: false })).toBe(false);
    expect(can("employee", "users.manageRoles")).toBe(false);
    expect(can("executive", "users.manageRoles")).toBe(true);
  });
  it("unknown action is denied and the matrix is enumerable", () => {
    expect(can("executive", "nope")).toBe(false);
    expect(PERMISSION_ACTIONS.length).toBeGreaterThan(8);
  });
});

describe("driver profile", () => {
  it("driver code is deterministic and formatted", () => {
    expect(driverCodeFor("abc")).toBe(driverCodeFor("abc"));
    expect(driverCodeFor("abc")).not.toBe(driverCodeFor("abd"));
    expect(driverCodeFor("pWMkS4vJ7bQ73rm82wgaAyP0dm92")).toMatch(/^DRV-[0-9A-Z]{6}$/);
  });
  it("validates name, phone, neighborhood keys and shift window", () => {
    const bad = validateDriverProfile({ fullName: "", phone: "12", neighborhoodKeys: ["حي المريخ"], shiftStart: "06:00" }, { knownNeighborhoodKeys: ["الخليج"] });
    expect(bad.ok).toBe(false);
    expect(bad.errors.length).toBe(4);
    const good = validateDriverProfile({ fullName: "أحمد", phone: "+966500000000", neighborhoodKeys: ["حي الخليج", "الخليج"], shiftStart: "06:00", shiftEnd: "14:00" }, { knownNeighborhoodKeys: ["الخليج"] });
    expect(good.ok).toBe(true);
    expect(good.value.neighborhoodKeys).toEqual(["الخليج"]); // normalized + de-duplicated
  });
});

describe("vehicle ↔ driver assignment conflicts", () => {
  const existing = [
    { id: "a1", driverId: "D1", driverName: "أحمد", vehicleId: "V1", start: iso(t0), end: iso(t0 + 8 * H) },
    { id: "a2", driverId: "D2", vehicleId: "V2", start: iso(t0), end: null },
    { id: "a3", driverId: "D3", vehicleId: "V3", start: iso(t0), end: iso(t0 + 8 * H), active: false },
  ];
  it("overlap maths", () => {
    expect(windowsOverlap({ start: t0, end: t0 + H }, { start: t0 + H, end: t0 + 2 * H })).toBe(false);
    expect(windowsOverlap({ start: t0, end: t0 + 2 * H }, { start: t0 + H, end: t0 + 3 * H })).toBe(true);
    expect(windowsOverlap({ start: t0, end: null }, { start: t0 + 100 * H, end: t0 + 101 * H })).toBe(true);
  });
  it("rejects the same vehicle for two drivers in overlapping shifts", () => {
    const c = findVehicleAssignmentConflicts({ driverId: "D9", vehicleId: "V1", start: iso(t0 + 4 * H), end: iso(t0 + 12 * H) }, existing);
    expect(c.map((x) => x.type)).toEqual(["vehicle_double_booked"]);
  });
  it("allows the same vehicle in a non-overlapping shift", () => {
    expect(findVehicleAssignmentConflicts({ driverId: "D9", vehicleId: "V1", start: iso(t0 + 8 * H), end: iso(t0 + 16 * H) }, existing)).toEqual([]);
  });
  it("rejects a driver holding two vehicles at once, ignores inactive history, ignores self-edit", () => {
    expect(findVehicleAssignmentConflicts({ driverId: "D1", vehicleId: "V5", start: iso(t0 + H), end: iso(t0 + 2 * H) }, existing)[0].type).toBe("driver_double_vehicle");
    expect(findVehicleAssignmentConflicts({ driverId: "D9", vehicleId: "V3", start: iso(t0), end: iso(t0 + H) }, existing)).toEqual([]);
    expect(findVehicleAssignmentConflicts({ id: "a1", driverId: "D1", vehicleId: "V1", start: iso(t0), end: iso(t0 + 9 * H) }, existing)).toEqual([]);
  });
  it("resolves the assignment in force and the vehicle holder at a time", () => {
    expect(activeAssignmentFor("D1", existing, t0 + 2 * H)?.id).toBe("a1");
    expect(activeAssignmentFor("D1", existing, t0 + 9 * H)).toBeNull();
    expect(vehicleHolderAt("V2", existing, t0 + 500 * H)?.driverId).toBe("D2");
    expect(vehicleHolderAt("V3", existing, t0 + H)).toBeNull();
  });
});

describe("route assignment guards", () => {
  const routes = [
    { id: "r1", routeName: "جولة الخليج", status: "in_progress", driverId: "D1", vehicleId: "V1" },
    { id: "r2", routeName: "جولة الريان", status: "completed", driverId: "D1", vehicleId: "V1" },
    { id: "r3", routeName: "جولة النخيل", status: "approved", driverId: "D2", vehicleId: "V2" },
  ];
  it("one active route per driver", () => {
    expect(findRouteAssignmentConflicts({ routeId: "r9", driverId: "D1", vehicleId: "V7" }, routes)[0].type).toBe("driver_has_active_route");
    expect(findRouteAssignmentConflicts({ routeId: "r9", driverId: "D3", vehicleId: "V7" }, routes)).toEqual([]);
  });
  it("vehicle cannot be on two active routes; completed routes do not block; editing itself does not block", () => {
    expect(findRouteAssignmentConflicts({ routeId: "r9", driverId: "D3", vehicleId: "V2" }, routes)[0].type).toBe("vehicle_on_active_route");
    expect(findRouteAssignmentConflicts({ routeId: "r1", driverId: "D1", vehicleId: "V1" }, routes)).toEqual([]);
  });
});

describe("coverage", () => {
  const profiles = [
    { uid: "D1", fullName: "أحمد", accountStatus: "active", shiftStatus: "on_shift", availability: "available", vehicleId: "V1", neighborhoodKeys: ["الخليج", "الريان"] },
    { uid: "D2", fullName: "خالد", accountStatus: "active", shiftStatus: "off_shift", availability: "available", vehicleId: "V2", neighborhoodKeys: ["الخليج"] },
    { uid: "D3", fullName: "سعد", accountStatus: "active", shiftStatus: "on_shift", availability: "available", vehicleId: "V3", neighborhoodKeys: ["النخيل"] },
    { uid: "D4", fullName: "فهد", accountStatus: "pending", shiftStatus: "on_shift", availability: "available", vehicleId: null, neighborhoodKeys: ["الخليج"] },
  ];
  const vehicles = [{ id: "V1", status: "available" }, { id: "V2", status: "available" }, { id: "V3", status: "maintenance" }];
  it("drivers covering a neighborhood (name normalized)", () => {
    expect(driversCovering("حي الخليج", profiles).map((p) => p.uid)).toEqual(["D1", "D2", "D4"]);
    expect(coverageMatrix(["الخليج", "النقع"], profiles)["النقع"]).toEqual([]);
  });
  it("eligible drivers explain every exclusion", () => {
    const r = eligibleDriversFor("الخليج", { profiles, vehicles, routes: [] });
    const by = Object.fromEntries(r.map((x) => [x.profile.uid, x]));
    expect(by.D1.eligible).toBe(true);
    expect(by.D2.reasons).toContain("خارج المناوبة");
    expect(by.D3.reasons).toEqual(expect.arrayContaining(["خارج نطاق التغطية", "المركبة في الصيانة"]));
    expect(by.D4.reasons).toEqual(expect.arrayContaining(["الحساب غير مفعّل", "لا توجد مركبة مسندة"]));
    expect(r[0].profile.uid).toBe("D1"); // eligible first
  });
  it("a driver already on an active route is not eligible", () => {
    const r = eligibleDriversFor("الخليج", { profiles, vehicles, routes: [{ id: "r1", routeName: "جولة", status: "in_progress", driverId: "D1" }] });
    expect(r.find((x) => x.profile.uid === "D1").eligible).toBe(false);
    expect(r.every((x) => !x.eligible)).toBe(true); // → admin gets the "no eligible driver" warning
  });
  it("location freshness", () => {
    const now = Date.now();
    expect(locationFreshness(null).state).toBe("none");
    expect(locationFreshness({ at: new Date(now - 60000).toISOString() }, { now }).state).toBe("live");
    expect(locationFreshness({ at: new Date(now - 20 * 60000).toISOString() }, { now })).toEqual({ state: "stale", ageMin: 20 });
  });
});
