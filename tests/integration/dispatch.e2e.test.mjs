/* global process */
/**
 * END-TO-END autonomous dispatch test (isolated emulators: Firestore with the real firestore.rules + Auth).
 *   npm run test:e2e
 *
 * The server side runs exactly as in production (api/_lib/dispatchRunner.mjs with firebase-admin);
 * the DRIVER and the OPERATIONS EMPLOYEE act through the client SDK, signed in, so every read and
 * write they make passes through the security rules — the route must really reach the driver's account.
 *
 *  1 create a demo bin            2 raise it to 92 %           3 run the engine (critical reading)
 *  4 route created / extended     5 eligible driver chosen      6 assignment persisted (+ audit reason)
 *  7 visible in the driver's account (rules)                    8 driver starts the route
 *  9 driver confirms the emptying 10 route status updated        11 operations view updated
 * + failure policies: routing service down, broken vehicle, no driver, out of scope, restart (idempotency)
 */
process.env.GCLOUD_PROJECT ||= "swm-dispatch-e2e";
const { adminDb, adminAuth } = await import("../../api/_lib/firebaseAdmin.mjs");
const { runDispatchCycle } = await import("../../api/_lib/dispatchRunner.mjs");
const confirmHandler = (await import("../../api/field/confirm-collection.js")).default;
const { initializeApp } = await import("firebase/app");
const { getAuth, connectAuthEmulator, signInWithEmailAndPassword } = await import("firebase/auth");
const { getFirestore, connectFirestoreEmulator, collection, query, where, getDocs, getDoc, doc, updateDoc, arrayUnion, terminate } = await import("firebase/firestore");

const db = adminDb();
let passed = 0, failed = 0;
const ok = (c, m) => { if (!c) throw new Error(m); };
async function test(name, fn) { try { await fn(); passed++; console.log("  ✓", name); } catch (e) { failed++; console.log("  ✗", name, "\n     ", e.message); } }
const iso = (ms = Date.now()) => new Date(ms).toISOString();
const [fsHost, fsPort] = process.env.FIRESTORE_EMULATOR_HOST.split(":");

// Deterministic road service for the test (the real one is OSRM): minutes = 3 × air km.
const fakeRoads = async (pts) => {
  const km = (a, b) => { const R = 6371, t = (x) => (x * Math.PI) / 180, dLat = t(b.lat - a.lat), dLng = t(b.lng - a.lng); return 2 * R * Math.asin(Math.sqrt(Math.sin(dLat / 2) ** 2 + Math.cos(t(a.lat)) * Math.cos(t(b.lat)) * Math.sin(dLng / 2) ** 2)); };
  return { durations: pts.map((a) => pts.map((b) => km(a, b) * 3)), distances: pts.map((a) => pts.map((b) => km(a, b) * 1.3)), source: "osrm" };
};
const failingRoads = async () => { throw new Error("routing service unavailable"); };

async function client(email, password) {
  const app = initializeApp({ apiKey: "fake", projectId: process.env.GCLOUD_PROJECT, authDomain: "localhost" }, email);
  const auth = getAuth(app); connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true });
  const fs = getFirestore(app); connectFirestoreEmulator(fs, fsHost, Number(fsPort));
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return { fs, uid: cred.user.uid, token: await cred.user.getIdToken() };
}
async function wipe() {
  for (const c of ["bins", "neighborhoods", "driver_profiles", "vehicles", "collection_routes", "route_incidents", "dispatch_decisions", "dispatch_runs", "dispatch_locks", "dispatch_settings", "driver_notifications", "audit_log", "municipalities", "simulated_readings", "sensor_readings", "fire_sensors", "citizen_reports", "collection_events"]) {
    const s = await db.collection(c).get(); if (!s.empty) { const b = db.batch(); s.docs.forEach((d) => b.delete(d.ref)); await b.commit(); }
  }
}
const PW = "pw-e2e-123456";
async function user(uid, role, extra = {}) {
  await adminAuth().createUser({ uid, email: `${uid}@e2e.local`, password: PW }).catch(() => {});
  await db.doc(`users/${uid}`).set({ uid, role, status: "active", municipalityId: "east", fullName: uid, ...extra });
}
async function seedWorld() {
  await wipe();
  const b = db.batch();
  b.set(db.doc("municipalities/east"), { id: "east" });
  b.set(db.doc("neighborhoods/n1"), { name: "حي الخليج", municipalityId: "east" });
  b.set(db.doc("neighborhoods/n2"), { name: "حي الشروق", municipalityId: "east" });
  // D1: eligible (on shift, covers الخليج, vehicle OK) · D2: covers only الشروق · D3: off shift
  for (const [d, keys, shift] of [["drv1", ["الخليج", "الشروق"], "on_shift"], ["drv2", ["الشروق"], "on_shift"], ["drv3", ["الخليج"], "off_shift"]]) {
    b.set(db.doc(`driver_profiles/${d}`), { uid: d, fullName: `سائق ${d}`, accountStatus: "active", shiftStatus: shift, availability: "available", vehicleId: `V${d}`, neighborhoodKeys: keys, municipalityId: "east" });
    b.set(db.doc(`vehicles/V${d}`), { vehicleNumber: `مركبة ${d}`, status: "available", capacityLiters: 8000, depotLat: 26.33, depotLng: 43.95, driverId: d, municipalityId: "east" });
  }
  b.set(db.doc("dispatch_settings/config"), { mode: "auto", scope: "demo_only", periodMinutes: 15 });
  await b.commit();
  await user("drv1", "driver"); await user("drv2", "driver"); await user("ops1", "employee");
}
const setBin = (id, data) => db.doc(`bins/${id}`).set({ name: id, neighborhoodId: "n1", municipalityId: "east", deviceId: "dev-" + id, capacityLiters: 1100, lastTemperatureCelsius: 28, lat: 26.360, lng: 43.970, demo: true, simulated: true, ...data }, { merge: true });
const reading = async (id, fill) => { const at = iso(); await db.collection("simulated_readings").add({ bin_id: id, fill_level_percent: fill, temperature_celsius: 28, timestamp: at, source: "SIMULATED", demo: true }); await setBin(id, { lastFillLevelPercent: fill, lastReadingAt: at }); };

console.log("\nAutonomous dispatch — END-TO-END (server + driver/operations through security rules)");
await seedWorld();
let route = null;

await test("1–2 · a demo bin is created and its sensor reports 92 %", async () => {
  await setBin("e2e-bin", { lastFillLevelPercent: 40, lastReadingAt: iso() });
  await reading("e2e-bin", 92);
  ok((await db.doc("bins/e2e-bin").get()).get("lastFillLevelPercent") === 92, "fill not 92");
});

await test("3–6 · the engine (critical-reading trigger) creates a route, picks the eligible driver over road time, persists it with its reason", async () => {
  const r = await runDispatchCycle(db, { trigger: "critical_reading", municipalityId: "east", roadMatrix: fakeRoads });
  ok(r.municipalities.east.executed >= 1, `executed=${r.municipalities.east.executed}`);
  ok(r.municipalities.east.routingStatus === "ok", `routing=${r.municipalities.east.routingStatus}`);
  const routes = (await db.collection("collection_routes").where("status", "==", "approved").get()).docs.filter((d) => (d.get("binIds") || []).includes("e2e-bin"));
  ok(routes.length === 1, `routes with the bin: ${routes.length}`);
  route = { id: routes[0].id, ...routes[0].data() };
  ok(route.driverId === "drv1", `driver ${route.driverId} (drv2 is out of scope, drv3 off shift)`);
  ok(route.dispatch?.auto && route.dispatch.reason.includes("ضمن النطاق"), "no recorded reason");
  ok(route.approvedBy === "system:auto-dispatch" && route.vehicleId === "Vdrv1", "approval/vehicle not persisted");
  const dec = (await db.collection("dispatch_decisions").where("routeId", "==", route.id).get()).docs[0]?.data();
  ok(dec?.status === "executed" && dec.travelSource === "osrm", `decision ${dec?.status} / ${dec?.travelSource}`);
  const audit = (await db.collection("audit_log").where("action", "==", "route_auto_assigned").get()).docs.map((d) => d.data());
  ok(audit.some((a) => a.details.routeId === route.id && a.details.reason), "no audit entry with the reason");
});

await test("7 · the route and its notification reach the DRIVER's account (client SDK, security rules)", async () => {
  const { fs, uid, token } = await client("drv1@e2e.local", PW);
  const mine = await getDocs(query(collection(fs, "collection_routes"), where("driverId", "==", uid)));
  ok(mine.docs.some((d) => d.id === route.id), "route not visible to the driver");
  const notes = await getDocs(query(collection(fs, "driver_notifications"), where("driverId", "==", uid)));
  ok(notes.docs.some((d) => d.get("routeId") === route.id && d.get("type") === "route_assigned"), "no notification");
  const other = await client("drv2@e2e.local", PW);
  const theirs = await getDocs(query(collection(other.fs, "collection_routes"), where("driverId", "==", other.uid)));
  ok(!theirs.docs.some((d) => d.id === route.id), "another driver can see the route");
  await terminate(other.fs);
  globalThis.__driver = { fs, uid, token };
});

await test("8–10 · the driver starts, confirms each emptying THROUGH THE SERVER (direct writes denied) and finishes — the route status follows", async () => {
  const { fs, token } = globalThis.__driver;
  const confirm = async (body) => { let code = 0, out = null; const res = { setHeader() {}, status(c) { code = c; return res; }, json(o) { out = o; } }; await confirmHandler({ method: "POST", headers: { authorization: `Bearer ${token}` }, body }, res); return { code, out }; };
  ok((await confirm({ routeId: route.id, binId: route.binIds[0] })).code === 409, "confirmed before the route started");
  await updateDoc(doc(fs, "collection_routes", route.id), { status: "in_progress", startedAt: iso(), updatedAt: iso() });
  await updateDoc(doc(fs, "vehicles", "Vdrv1"), { status: "on_route", currentRouteId: route.id, updatedAt: iso() });
  for (const binId of route.binIds) {
    let denied = false; try { await updateDoc(doc(fs, "collection_routes", route.id), { collectedBinIds: arrayUnion(binId) }); } catch { denied = true; }
    ok(denied, "driver wrote collection progress directly");
    const r = await confirm({ routeId: route.id, binId, clientConfirmedAt: iso() });
    ok(r.code === 200 && r.out.duplicate === false, `confirm ${r.code} ${JSON.stringify(r.out)}`);
  }
  await updateDoc(doc(fs, "collection_routes", route.id), { status: "completed", completedAt: iso(), updatedAt: iso() });
  await updateDoc(doc(fs, "vehicles", "Vdrv1"), { status: "available", currentRouteId: null, updatedAt: iso() });
  const after = (await db.doc(`collection_routes/${route.id}`).get()).data();
  ok(after.status === "completed" && after.collectedBinIds.length === route.binIds.length, `status ${after.status}, collected ${after.collectedBinIds?.length}`);
  ok((await db.doc(`collection_events/${route.id}__e2e-bin`).get()).exists, "collection event missing");
});

await test("11 · operations sees the completed route and the executed decision; the sensor's emptied reading clears the demand", async () => {
  const { fs } = await client("ops1@e2e.local", PW);
  const r = await getDoc(doc(fs, "collection_routes", route.id));
  ok(r.get("status") === "completed", "operations does not see the completion");
  const decs = await getDocs(query(collection(fs, "dispatch_decisions"), where("municipalityId", "==", "east")));
  ok(decs.docs.some((d) => d.get("routeId") === route.id && d.get("status") === "executed"), "operations does not see the decision");
  await reading("e2e-bin", 6); // the sensor's response to the physical emptying
  const again = await runDispatchCycle(db, { trigger: "manual", municipalityId: "east", roadMatrix: fakeRoads });
  ok(again.municipalities.east.created === 0, "a new route was created for an emptied bin");
  await terminate(fs);
});

await test("restart / repeated trigger: the same situation never produces a second assignment", async () => {
  await reading("e2e-bin2", 93); await setBin("e2e-bin2", { lat: 26.361, lng: 43.971 });
  await runDispatchCycle(db, { trigger: "critical_reading", municipalityId: "east", roadMatrix: fakeRoads });
  const count = async () => (await db.collection("collection_routes").where("status", "in", ["approved", "in_progress"]).get()).docs.filter((d) => (d.get("binIds") || []).includes("e2e-bin2")).length;
  ok((await count()) === 1, "not assigned once");
  await Promise.all([runDispatchCycle(db, { trigger: "cron", force: true, roadMatrix: fakeRoads }), runDispatchCycle(db, { trigger: "critical_reading", municipalityId: "east", roadMatrix: fakeRoads })]);
  ok((await count()) === 1, "bin assigned twice after restart/concurrent runs");
});

await test("routing service down → assignment still happens on a labelled estimate (never blocked, never silent)", async () => {
  await seedWorld();
  await reading("e2e-r", 94); await setBin("e2e-r", {});
  const r = await runDispatchCycle(db, { trigger: "critical_reading", municipalityId: "east", roadMatrix: failingRoads });
  ok(r.municipalities.east.routingStatus === "failed", `routing=${r.municipalities.east.routingStatus}`);
  const dec = (await db.collection("dispatch_decisions").where("type", "==", "create_assign").get()).docs[0]?.data();
  ok(dec?.status === "executed" && /تعذر الاتصال بخدمة المسارات/.test(dec.routingNote || ""), `note: ${dec?.routingNote}`);
});

await test("broken vehicle / no driver / out of scope → a clear exception for operations, no invented driver", async () => {
  await seedWorld();
  await db.doc("vehicles/Vdrv1").update({ status: "maintenance" });
  await reading("x1", 95); await setBin("x1", {});
  await runDispatchCycle(db, { trigger: "critical_reading", municipalityId: "east", roadMatrix: fakeRoads });
  let open = (await db.collection("dispatch_decisions").where("status", "==", "open").get()).docs.map((d) => d.get("kind"));
  ok(open.includes("no_vehicle"), `expected no_vehicle, got ${open.join(",")}`);
  ok((await db.collection("collection_routes").where("status", "==", "approved").get()).empty, "a route was assigned to a broken vehicle");
  await seedWorld();
  await db.doc("driver_profiles/drv1").update({ shiftStatus: "off_shift" });
  await reading("x2", 95); await setBin("x2", {});
  await runDispatchCycle(db, { trigger: "critical_reading", municipalityId: "east", roadMatrix: fakeRoads });
  open = (await db.collection("dispatch_decisions").where("status", "==", "open").get()).docs.map((d) => d.get("kind"));
  ok(open.includes("out_of_scope") || open.includes("no_driver"), `expected out_of_scope/no_driver, got ${open.join(",")}`);
  ok((await db.collection("collection_routes").where("status", "==", "approved").get()).empty, "drv2 (outside the neighborhood) or drv3 (off shift) was assigned");
});

console.log(`\nDispatch E2E: ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
