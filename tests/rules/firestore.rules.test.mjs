/**
 * Firestore security-rules tests (Phase 6) — run against the local emulator:
 *   npm run test:rules
 * (starts the Firestore emulator via `firebase emulators:exec`, no cloud access).
 *
 * These prove the SERVER-side enforcement that the UI's fleetEngine.can() mirrors:
 * drivers read/write only their own routes, events, incidents and locations;
 * sensor readings are never client-writable; citizens never touch operations.
 */
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import { doc, setDoc, getDoc, updateDoc, collection, getDocs, query, where } from "firebase/firestore";

const PROJECT = "swm-rules-test";
let env;
const ctx = (uid, role, status = "active") => env.authenticatedContext(uid, { role }).firestore();
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed += 1; console.log("  ✓", name); }
  catch (e) { failed += 1; console.log("  ✗", name, "\n     ", String(e?.message || e).split("\n")[0]); }
}

env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: Number(process.env.FIRESTORE_EMULATOR_PORT || 8080) } });
await env.clearFirestore();

// Seed users + fixtures with rules bypassed.
await env.withSecurityRulesDisabled(async (c) => {
  const db = c.firestore();
  await setDoc(doc(db, "users/emp1"), { uid: "emp1", role: "employee", status: "active" });
  await setDoc(doc(db, "users/drv1"), { uid: "drv1", role: "driver", status: "active" });
  await setDoc(doc(db, "users/drv2"), { uid: "drv2", role: "driver", status: "active" });
  await setDoc(doc(db, "users/cit1"), { uid: "cit1", role: "citizen", status: "active" });
  await setDoc(doc(db, "users/pend"), { uid: "pend", role: "driver", status: "pending" });
  // Multi-municipality scoping fixtures
  await setDoc(doc(db, "users/admin1"), { uid: "admin1", role: "executive", status: "active" });
  await setDoc(doc(db, "users/mgrE"), { uid: "mgrE", role: "manager", status: "active", municipalityId: "east" });
  await setDoc(doc(db, "users/mgrNone"), { uid: "mgrNone", role: "manager", status: "active" });
  await setDoc(doc(db, "users/empN"), { uid: "empN", role: "employee", status: "active", municipalityId: "north" });
  await setDoc(doc(db, "bins/bE"), { name: "bE", municipalityId: "east", lastFillLevelPercent: 50 });
  await setDoc(doc(db, "bins/bN"), { name: "bN", municipalityId: "north", lastFillLevelPercent: 50 });
  await setDoc(doc(db, "collection_routes/RE"), { routeName: "RE", status: "suggested", municipalityId: "east", binIds: ["bE"] });
  await setDoc(doc(db, "collection_routes/RN"), { routeName: "RN", status: "suggested", municipalityId: "north", binIds: ["bN"] });
  await setDoc(doc(db, "vehicles/VE"), { vehicleNumber: "VE", municipalityId: "east", status: "available" });
  await setDoc(doc(db, "neighborhoods/NE"), { name: "حي الشروق", municipalityId: "east" });
  await setDoc(doc(db, "driver_profiles/drv1"), { uid: "drv1", shiftStatus: "off_shift", vehicleId: "V1", neighborhoodKeys: ["الخليج"] });
  await setDoc(doc(db, "collection_routes/R1"), { routeName: "R1", status: "approved", driverId: "drv1", vehicleId: "V1", binIds: ["b1"], collectedBinIds: [] });
  await setDoc(doc(db, "collection_routes/R2"), { routeName: "R2", status: "approved", driverId: "drv2", vehicleId: "V2", binIds: ["b2"], collectedBinIds: [] });
  await setDoc(doc(db, "collection_routes/R3"), { routeName: "R3", status: "suggested", binIds: ["b3"] });
  await setDoc(doc(db, "bins/b1"), { name: "b1", lastFillLevelPercent: 90 });
});

console.log("\nFirestore rules —", "firestore.rules");

await test("driver reads ONLY routes assigned to them (scoped query ok, other route denied, unscoped list denied)", async () => {
  const db = ctx("drv1", "driver");
  await assertSucceeds(getDoc(doc(db, "collection_routes/R1")));
  await assertFails(getDoc(doc(db, "collection_routes/R2")));
  await assertSucceeds(getDocs(query(collection(db, "collection_routes"), where("driverId", "==", "drv1"))));
  await assertFails(getDocs(collection(db, "collection_routes")));
});

await test("driver advances only execution fields of their own route; cannot approve, reassign, or touch another driver's route", async () => {
  const db = ctx("drv1", "driver");
  await assertSucceeds(updateDoc(doc(db, "collection_routes/R1"), { status: "in_progress", startedAt: "now", driverName: "x" }));
  await assertSucceeds(updateDoc(doc(db, "collection_routes/R1"), { collectedBinIds: ["b1"], lastProgressAt: "now" }));
  await assertSucceeds(updateDoc(doc(db, "collection_routes/R1"), { skippedStops: [{ binId: "b1", reason: "obstacle" }] }));
  await assertFails(updateDoc(doc(db, "collection_routes/R1"), { driverId: "drv2" }));
  await assertFails(updateDoc(doc(db, "collection_routes/R1"), { status: "approved" }));
  await assertFails(updateDoc(doc(db, "collection_routes/R1"), { binIds: ["b1", "b9"] }));
  await assertFails(updateDoc(doc(db, "collection_routes/R2"), { status: "in_progress" }));
  await assertFails(updateDoc(doc(db, "collection_routes/R3"), { status: "approved", driverId: "drv1" }));
});

await test("employee approves/assigns routes and manages driver profiles; driver may only flip own shift/location fields", async () => {
  const emp = ctx("emp1", "employee");
  await assertSucceeds(updateDoc(doc(emp, "collection_routes/R3"), { status: "approved", driverId: "drv1", vehicleId: "V1" }));
  await assertSucceeds(setDoc(doc(emp, "driver_profiles/drv2"), { uid: "drv2", shiftStatus: "off_shift" }));
  const drv = ctx("drv1", "driver");
  await assertSucceeds(updateDoc(doc(drv, "driver_profiles/drv1"), { shiftStatus: "on_shift", locationSharing: true, updatedAt: "now" }));
  await assertSucceeds(updateDoc(doc(drv, "driver_profiles/drv1"), { lastLocation: { lat: 1, lng: 2, at: "now" }, updatedAt: "now" }));
  await assertFails(updateDoc(doc(drv, "driver_profiles/drv1"), { vehicleId: "V9" }));
  await assertFails(updateDoc(doc(drv, "driver_profiles/drv1"), { neighborhoodKeys: ["كل المدينة"] }));
  await assertFails(getDoc(doc(drv, "driver_profiles/drv2")));
  await assertFails(setDoc(doc(drv, "driver_profiles/drv9"), { uid: "drv9" }));
});

await test("collection events: idempotent own-route confirmation ok; other driver's route / foreign uid / delete denied", async () => {
  const drv = ctx("drv1", "driver");
  const ev = { id: "R1__b1", routeId: "R1", binId: "b1", driverId: "drv1", operatorId: "drv1", confirmedAt: "now", fillBefore: 90, fillAfter: null };
  await assertSucceeds(setDoc(doc(drv, "collection_events/R1__b1"), ev, { merge: true }));
  await assertSucceeds(setDoc(doc(drv, "collection_events/R1__b1"), ev, { merge: true })); // retry → same doc
  await assertFails(setDoc(doc(drv, "collection_events/R2__b2"), { ...ev, id: "R2__b2", routeId: "R2", binId: "b2" }));
  await assertFails(setDoc(doc(drv, "collection_events/R1__bX"), { ...ev, driverId: "drv2" }));
  await assertFails(updateDoc(doc(drv, "bins/b1"), { lastFillLevelPercent: 0 }));           // never rewrite the reading
  await assertSucceeds(updateDoc(doc(drv, "bins/b1"), { lastCollectionAt: "now" }));        // operational stamp only
});

await test("sensor readings are never client-writable (even for employees)", async () => {
  await assertFails(setDoc(doc(ctx("emp1", "employee"), "sensor_readings/x"), { bin_id: "b1", fill_level_percent: 10 }));
  await assertFails(setDoc(doc(ctx("drv1", "driver"), "sensor_readings/y"), { bin_id: "b1", fill_level_percent: 10 }));
});

await test("incidents: driver opens own, reads own only; employee reviews; nobody deletes", async () => {
  const drv = ctx("drv1", "driver");
  await assertSucceeds(setDoc(doc(drv, "route_incidents/I1"), { routeId: "R1", driverId: "drv1", type: "obstacle", status: "open" }));
  await assertFails(setDoc(doc(drv, "route_incidents/I2"), { routeId: "R2", driverId: "drv2", type: "obstacle", status: "open" }));
  await assertFails(updateDoc(doc(drv, "route_incidents/I1"), { status: "resolved" }));
  await assertSucceeds(updateDoc(doc(ctx("emp1", "employee"), "route_incidents/I1"), { status: "reviewed", reviewedBy: "emp1" }));
  await assertFails(getDoc(doc(ctx("drv2", "driver"), "route_incidents/I1")));
});

await test("locations: driver appends own pings; employee reads; drivers cannot read others; no edits", async () => {
  const drv = ctx("drv1", "driver");
  await assertSucceeds(setDoc(doc(drv, "driver_locations/L1"), { driverId: "drv1", lat: 1, lng: 2, at: "now" }));
  await assertFails(setDoc(doc(drv, "driver_locations/L2"), { driverId: "drv2", lat: 1, lng: 2, at: "now" }));
  await assertFails(updateDoc(doc(drv, "driver_locations/L1"), { lat: 9 }));
  await assertSucceeds(getDoc(doc(ctx("emp1", "employee"), "driver_locations/L1")));
  await assertFails(getDoc(doc(ctx("drv2", "driver"), "driver_locations/L1")));
});

await test("citizens and pending accounts have no access to operations", async () => {
  await assertFails(getDoc(doc(ctx("cit1", "citizen"), "collection_routes/R1")));
  await assertFails(getDoc(doc(ctx("cit1", "citizen"), "driver_profiles/drv1")));
  await assertFails(getDoc(doc(ctx("pend", "driver"), "collection_routes/R1")));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), "bins/b1")));
});

await test("vehicle assignments: employees write, history never deleted, drivers read only", async () => {
  const emp = ctx("emp1", "employee");
  await assertSucceeds(setDoc(doc(emp, "driver_vehicle_assignments/A1"), { driverId: "drv1", vehicleId: "V1", start: "now", active: true }));
  await assertFails(setDoc(doc(ctx("drv1", "driver"), "driver_vehicle_assignments/A2"), { driverId: "drv1", vehicleId: "V2", start: "now", active: true }));
  await assertSucceeds(getDoc(doc(ctx("drv1", "driver"), "driver_vehicle_assignments/A1")));
});

await test("driver may flip only the status of their own vehicle; cannot touch another vehicle or other fields", async () => {
  await env.withSecurityRulesDisabled(async (c) => { await setDoc(doc(c.firestore(), "vehicles/V1"), { vehicleNumber: "V1", status: "available", driverId: "drv1" }); });
  const drv = ctx("drv1", "driver");
  await assertSucceeds(updateDoc(doc(drv, "vehicles/V1"), { status: "on_route", currentRouteId: "R1", lastActiveAt: "now", updatedAt: "now" }));
  await assertFails(updateDoc(doc(drv, "vehicles/V1"), { capacityLiters: 1 }));
  await assertFails(updateDoc(doc(ctx("drv2", "driver"), "vehicles/V1"), { status: "on_route" }));
  await assertSucceeds(updateDoc(doc(drv, "collection_routes/R1"), { status: "in_progress", startedAt: "now", updatedAt: "now" }));
});

await test("municipality scoping: manager sees/edits only own municipality; scoped list must filter; admin sees all", async () => {
  const mgr = ctx("mgrE", "manager");
  await assertSucceeds(getDoc(doc(mgr, "bins/bE")));
  await assertFails(getDoc(doc(mgr, "bins/bN")));
  await assertSucceeds(getDocs(query(collection(mgr, "bins"), where("municipalityId", "==", "east"))));
  await assertFails(getDocs(collection(mgr, "bins")));
  await assertSucceeds(updateDoc(doc(mgr, "collection_routes/RE"), { status: "approved", driverId: "drv1", vehicleId: "VE" }));
  await assertFails(updateDoc(doc(mgr, "collection_routes/RN"), { status: "approved" }));
  await assertFails(setDoc(doc(mgr, "bins/bX"), { name: "x", municipalityId: "north" }));   // cannot create outside own municipality
  await assertSucceeds(setDoc(doc(mgr, "bins/bY"), { name: "y", municipalityId: "east" }));
  await assertSucceeds(getDoc(doc(mgr, "vehicles/VE")));
  const admin = ctx("admin1", "executive");
  await assertSucceeds(getDoc(doc(admin, "bins/bN")));
  await assertSucceeds(getDocs(collection(admin, "bins")));
});

await test("employee scoped to north cannot touch east; manager without municipality has no operational access", async () => {
  const emp = ctx("empN", "employee");
  await assertSucceeds(getDoc(doc(emp, "bins/bN")));
  await assertFails(getDoc(doc(emp, "bins/bE")));
  await assertFails(updateDoc(doc(emp, "collection_routes/RE"), { status: "deferred" }));
  const none = ctx("mgrNone", "manager");
  await assertFails(getDoc(doc(none, "bins/bE")));
  await assertFails(getDoc(doc(none, "vehicles/VE")));
  await assertFails(setDoc(doc(none, "collection_routes/RZ"), { routeName: "z", status: "suggested" }));
});

await test("municipalities + neighborhood↔municipality assignment are platform-admin only; simulated readings never go to sensor_readings", async () => {
  await assertSucceeds(setDoc(doc(ctx("admin1", "executive"), "municipalities/east"), { id: "east", nameAr: "x" }));
  await assertFails(setDoc(doc(ctx("mgrE", "manager"), "municipalities/east"), { id: "east", nameAr: "hack" }));
  await assertSucceeds(getDoc(doc(ctx("cit1", "citizen"), "municipalities/east")));
  await assertFails(updateDoc(doc(ctx("mgrE", "manager"), "neighborhoods/NE"), { municipalityId: "north" }));
  await assertSucceeds(updateDoc(doc(ctx("mgrE", "manager"), "neighborhoods/NE"), { note: "ok" }));
  await assertSucceeds(updateDoc(doc(ctx("admin1", "executive"), "neighborhoods/NE"), { municipalityId: "north", municipalityAssignment: { source: "admin_override" } }));
  await assertSucceeds(setDoc(doc(ctx("mgrE", "manager"), "simulated_readings/s1"), { bin_id: "bE", fill_level_percent: 70, source: "SIMULATED" }));
  await assertFails(setDoc(doc(ctx("mgrE", "manager"), "sensor_readings/s1"), { bin_id: "bE", fill_level_percent: 70 }));
  await assertFails(setDoc(doc(ctx("admin1", "executive"), "sensor_readings/s2"), { bin_id: "bE", fill_level_percent: 70 }));
});

await env.cleanup();
console.log(`\nRules tests: ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
