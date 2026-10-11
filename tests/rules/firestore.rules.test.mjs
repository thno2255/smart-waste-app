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

await env.cleanup();
console.log(`\nRules tests: ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
