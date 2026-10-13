/* global process */
/**
 * Minimum operational adjustment — server flow on isolated Firestore + Auth emulators (real rules, real ID tokens).
 *   npm run test:adjustment
 *
 * North municipality (simulated data): three critical bins, one crew whose truck cannot take the load, a second
 * driver without a vehicle and an idle truck. The analysis finds the deficit (capacity), compares the allowed
 * adjustments and recommends the cheapest valid one; an authorised manager approves it; the plan changes after
 * re-verification; the driver executes; the outcome is measured. Around it: authorization, scope, staleness,
 * idempotency, concurrent approvals, conflicting recommendations, routing failure and the Firestore rules.
 */
process.env.GCLOUD_PROJECT ||= "swm-adjust-test";
const { adminDb, adminAuth } = await import("../../api/_lib/firebaseAdmin.mjs");
const handler = (await import("../../api/ops/adjustment.js")).default;
const confirmHandler = (await import("../../api/field/confirm-collection.js")).default;
const { analyzeAdjustment, approveAdjustment, syncAdjustmentOutcomes } = await import("../../api/_lib/adjustment.mjs");
const { initializeApp } = await import("firebase/app");
const { getAuth, connectAuthEmulator, signInWithEmailAndPassword } = await import("firebase/auth");
const { getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, updateDoc, terminate } = await import("firebase/firestore");

const db = adminDb();
const PW = "pw-adjust-123456";
let passed = 0, failed = 0;
const ok = (c, m) => { if (!c) throw new Error(m); };
async function test(name, fn) { try { await fn(); passed++; console.log("  ✓", name); } catch (e) { failed++; console.log("  ✗", name, "\n     ", e.message); } }
const [fsHost, fsPort] = process.env.FIRESTORE_EMULATOR_HOST.split(":");
const iso = (ms) => new Date(ms).toISOString();
const fresh = () => iso(Date.now() - 60000);
const localHHMM = (ms) => { const d = new Date(ms + 180 * 60000); return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`; };
const SHIFT = { shiftStart: localHHMM(Date.now() - 2 * 3600000), shiftEnd: localHHMM(Date.now() + 6 * 3600000) };
const tokens = {};
async function mkUser(uid, data) { await adminAuth().createUser({ uid, email: `${uid.toLowerCase()}@a.local`, password: PW }).catch(() => {}); await db.doc(`users/${uid}`).set({ uid, fullName: uid, status: "active", ...data }); }
async function token(uid) {
  if (tokens[uid]) return tokens[uid];
  const r = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: `${uid.toLowerCase()}@a.local`, password: PW, returnSecureToken: true }) });
  return (tokens[uid] = (await r.json()).idToken);
}
async function call(h, uid, body) {
  let code = 0, out = null; const res = { setHeader() {}, status(c) { code = c; return res; }, json(o) { out = o; } };
  await h({ method: "POST", headers: { authorization: `Bearer ${await token(uid)}` }, body }, res);
  return { code, out };
}
async function client(uid) {
  const app = initializeApp({ apiKey: "fake", projectId: process.env.GCLOUD_PROJECT }, uid + Math.random());
  const auth = getAuth(app); connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true });
  const fs = getFirestore(app); connectFirestoreEmulator(fs, fsHost, Number(fsPort));
  await signInWithEmailAndPassword(auth, `${uid.toLowerCase()}@a.local`, PW);
  return fs;
}
const COLS = ["bins", "neighborhoods", "driver_profiles", "vehicles", "collection_routes", "collection_events", "route_incidents", "dispatch_settings", "dispatch_locks", "driver_notifications", "audit_log", "municipalities", "rate_limits", "simulated_readings", "sensor_readings", "adjustment_analyses", "resource_reservations", "resource_locks", "resource_transfers", "fire_sensors", "citizen_reports"];
async function wipe() { for (const c of COLS) { const s = await db.collection(c).get(); if (!s.empty) { const b = db.batch(); s.docs.forEach((d) => b.delete(d.ref)); await b.commit(); } } }
const O = { lat: 26.40, lng: 43.95 };
const bin = (id, fill, i) => ({ name: `حاوية ${id}`, neighborhoodId: "n1", municipalityId: "north", lastFillLevelPercent: fill, lastTemperatureCelsius: 25, lastReadingAt: fresh(), lat: O.lat + 0.004 + i * 0.002, lng: O.lng + 0.004 + i * 0.002, capacityLiters: 1100, demo: true, simulated: true });
const prof = (uid, extra = {}) => ({ uid, fullName: uid, municipalityId: "north", accountStatus: "active", shiftStatus: "on_shift", availability: "available", neighborhoodKeys: ["الشمال"], lastLocation: { ...O, at: fresh() }, ...SHIFT, ...extra });
async function seed() {
  await wipe();
  const b = db.batch();
  b.set(db.doc("municipalities/north"), { id: "north", shortAr: "الشمال" });
  b.set(db.doc("neighborhoods/n1"), { name: "حي الشمال", municipalityId: "north" });
  [["a", 95], ["b", 92], ["c", 90]].forEach(([id, f], i) => b.set(db.doc(`bins/${id}`), bin(id, f, i)));
  b.set(db.doc("driver_profiles/D1"), prof("D1", { vehicleId: "VD1" }));
  b.set(db.doc("driver_profiles/D2"), prof("D2", { vehicleId: null }));
  b.set(db.doc("vehicles/VD1"), { vehicleNumber: "مركبة 1", status: "available", capacityLiters: 2500, depotLat: O.lat, depotLng: O.lng, municipalityId: "north", driverId: "D1" });
  b.set(db.doc("vehicles/VSPARE"), { vehicleNumber: "مركبة احتياط", status: "available", capacityLiters: 8000, depotLat: O.lat, depotLng: O.lng, municipalityId: "north", driverId: null });
  b.set(db.doc("dispatch_settings/config"), { mode: "observe", scope: "demo_only", useRoadNetwork: false });
  await b.commit();
}
const analysis = async (id) => ({ id, ...(await db.doc(`adjustment_analyses/${id}`).get()).data() });

await mkUser("opsN", { role: "employee", municipalityId: "north" });
await mkUser("mgrN", { role: "manager", municipalityId: "north" });
await mkUser("mgrE", { role: "manager", municipalityId: "east" });
await mkUser("amanah", { role: "executive" });
await mkUser("D2", { role: "driver", municipalityId: "north" });
await seed();

let A1 = null;
await test("21/22. a driver cannot analyze; a manager of another municipality cannot analyze North", async () => {
  ok((await call(handler, "D2", { action: "analyze" })).code === 403, "driver allowed");
  ok((await call(handler, "mgrE", { action: "analyze", municipalityId: "north" })).code === 403, "other municipality allowed");
});
await test("analysis: deficit found (capacity), alternatives compared, cheapest valid one proposed — nothing changed yet", async () => {
  const r = await call(handler, "opsN", { action: "analyze" });
  ok(r.code === 200 && r.out.status === "PROPOSED", `status ${r.code} ${JSON.stringify(r.out)}`);
  A1 = r.out.id;
  const a = await analysis(A1);
  ok(a.deficit.cause === "CAPACITY", `cause ${a.deficit.cause}`);
  ok(a.recommendedId === "IDLE_VEHICLE:D2:VSPARE", `recommended ${a.recommendedId}`);
  ok(a.alternatives.length >= 2 && a.alternatives.some((x) => x.verdict === "COSTLIER"), "no comparison");
  ok(a.search.setsEvaluated === a.search.setsTotal, "search incomplete");
  ok(/سعة المركبات غير كافية/.test(a.summary), "summary");
  ok((await db.collection("collection_routes").get()).empty, "analysis changed the plan");
});
await test("21. an operations employee cannot approve a manager-level adjustment (403)", async () => {
  const r = await call(handler, "opsN", { action: "approve", analysisId: A1, alternativeId: "IDLE_VEHICLE:D2:VSPARE" });
  ok(r.code === 403 && /مدير البلدية/.test(r.out.error), `got ${r.code} ${r.out?.error}`);
});
await test("22. a manager of another municipality cannot approve North's analysis (403)", async () => {
  ok((await call(handler, "mgrE", { action: "approve", analysisId: A1, alternativeId: "IDLE_VEHICLE:D2:VSPARE" })).code === 403, "allowed");
});
await test("12. the idle vehicle goes to maintenance before approval → refused as stale, plan unchanged", async () => {
  await db.doc("vehicles/VSPARE").update({ status: "maintenance" });
  const r = await call(handler, "mgrN", { action: "approve", analysisId: A1, alternativeId: "IDLE_VEHICLE:D2:VSPARE" });
  ok(r.code === 409 && r.out.code === "STALE", `got ${r.code} ${JSON.stringify(r.out)}`);
  ok((await analysis(A1)).status === "STALE", "analysis not marked stale");
  ok((await db.doc("driver_profiles/D2").get()).get("vehicleId") == null, "vehicle linked anyway");
  await db.doc("vehicles/VSPARE").update({ status: "available" });
});
let A2 = null, A3 = null;
await test("11. two analyses recommend the same resource: the first approval wins, the second is refused (state changed)", async () => {
  A2 = (await call(handler, "opsN", { action: "analyze" })).out.id;
  A3 = (await call(handler, "mgrN", { action: "analyze" })).out.id;
  const x = await analysis(A2), y = await analysis(A3);
  ok(x.recommendedId === y.recommendedId, "different recommendations");
  const r1 = await call(handler, "mgrN", { action: "approve", analysisId: A2, alternativeId: x.recommendedId });
  ok(r1.code === 200 && r1.out.status === "APPROVED", `first ${r1.code} ${JSON.stringify(r1.out)}`);
  const r2 = await call(handler, "mgrN", { action: "approve", analysisId: A3, alternativeId: y.recommendedId });
  ok(r2.code === 409, `second ${r2.code}`);
  const routes = (await db.collection("collection_routes").get()).docs;
  ok(routes.every((d) => d.get("dispatch.adjustment.analysisId") === A2), "plan of the second analysis applied");
});
await test("13. approving the same analysis again is idempotent (no second route, one audit entry)", async () => {
  const before = (await db.collection("collection_routes").get()).size;
  const again = await call(handler, "mgrN", { action: "approve", analysisId: A2, alternativeId: (await analysis(A2)).recommendedId });
  ok(again.code === 200 && again.out.already === true, `got ${again.code}`);
  ok((await db.collection("collection_routes").get()).size === before, "duplicate route");
  ok((await db.collection("audit_log").where("action", "==", "adjustment_approved").get()).size === 1, "duplicate audit");
});
await test("plan updated after re-verification: vehicle linked, new route for D2, APPROVED (not executed), driver notified", async () => {
  const a = await analysis(A2);
  ok(a.status === "APPROVED" && a.approvedBy === "mgrN", "status");
  ok((await db.doc("driver_profiles/D2").get()).get("vehicleId") === "VSPARE" && (await db.doc("vehicles/VSPARE").get()).get("driverId") === "D2", "vehicle not linked");
  const route = (await db.collection("collection_routes").where("driverId", "==", "D2").get()).docs[0];
  ok(route && route.get("vehicleId") === "VSPARE" && route.get("status") === "approved" && route.get("dispatch.adjustment.analysisId") === A2, "route");
  ok(a.applied.createdRoutes.length === (await db.collection("collection_routes").get()).size, "created routes not all recorded");
  ok(a.expected.serviceLevelMet === true && a.expected.kmBasis === "expected_haversine", "expected record");
  ok(!(await db.collection("driver_notifications").where("driverId", "==", "D2").get()).empty, "driver not notified");
});
await test("18/24. partial execution is not completion; all stops collected → EXECUTED, actual saving stays 'not available'", async () => {
  const route = (await db.collection("collection_routes").where("driverId", "==", "D2").get()).docs[0];
  await route.ref.update({ status: "in_progress", startedAt: iso(Date.now() - 60000) });
  const stops = route.get("binIds");
  const c1 = await call(confirmHandler, "D2", { routeId: route.id, binId: stops[0] });
  ok(c1.code === 200, `confirm ${c1.code} ${JSON.stringify(c1.out)}`);
  await syncAdjustmentOutcomes(db, "north");
  let a = await analysis(A2);
  ok(a.status === "APPROVED" && ["IN_PROGRESS", "NOT_STARTED"].includes(a.outcome.state) && a.outcome.binsCollected === 1, `after 1: ${a.status} ${a.outcome?.state}`);
  for (const b of stops.slice(1)) ok((await call(confirmHandler, "D2", { routeId: route.id, binId: b })).code === 200, "confirm");
  await route.ref.update({ status: "completed", completedAt: iso(Date.now()) });
  // Other crews' routes of the same adjustment (D1 has no driver account here) are completed by the server-side record.
  for (const other of (await db.collection("collection_routes").where("dispatch.adjustment.analysisId", "==", A2).get()).docs.filter((d) => d.id !== route.id)) {
    for (const b of other.get("binIds")) await db.doc(`collection_events/${other.id}__${b}`).set({ routeId: other.id, binId: b, municipalityId: "north", confirmedAt: iso(Date.now()), verifiedBy: "server" });
    await other.ref.update({ status: "completed", completedAt: iso(Date.now()), collectedBinIds: other.get("binIds") });
  }
  await syncAdjustmentOutcomes(db, "north");
  a = await analysis(A2);
  ok(a.status === "EXECUTED" && a.outcome.binsCollected === a.outcome.binsPlanned && a.outcome.binsPlanned >= stops.length, `final ${a.status} ${a.outcome.binsCollected}/${a.outcome.binsPlanned}`);
  ok(a.outcome.realised.saving === null && /غير متاح/.test(a.outcome.realised.savingText), "saving invented");
});
await test("23. two concurrent approvals of DIFFERENT alternatives of one analysis → exactly one applied", async () => {
  await seed();
  const id = (await call(handler, "amanah", { action: "analyze", municipalityId: "north" })).out.id;
  const a = await analysis(id);
  const succ = a.alternatives.filter((x) => x.success);
  ok(succ.length >= 2, `need two valid alternatives, got ${succ.length}`);
  const [r1, r2] = await Promise.all([call(handler, "amanah", { action: "approve", analysisId: id, alternativeId: succ[0].id }), call(handler, "amanah", { action: "approve", analysisId: id, alternativeId: succ[1].id })]);
  const codes = [r1.code, r2.code].sort();
  ok(codes[0] === 200 && codes[1] === 409, `codes ${codes}`);
  const final = await analysis(id);
  ok(final.status === "APPROVED" && [succ[0].id, succ[1].id].includes(final.approvedAlternativeId), "not one alternative");
  ok((await db.collection("audit_log").where("action", "==", "adjustment_approved").get()).size === 1, "two approvals applied");
});
await test("reject: a proposal can be rejected; a rejected one cannot be approved", async () => {
  await seed();
  const id = (await call(handler, "mgrN", { action: "analyze" })).out.id;
  ok((await call(handler, "mgrN", { action: "reject", analysisId: id, note: "قرار إداري" })).code === 200, "reject");
  ok((await analysis(id)).status === "REJECTED", "status");
  ok((await call(handler, "mgrN", { action: "approve", analysisId: id, alternativeId: (await analysis(id)).recommendedId })).code === 409, "approved after reject");
});
await test("16. routing service down → the analysis completes on labelled estimates", async () => {
  await seed();
  await db.doc("dispatch_settings/config").set({ useRoadNetwork: true }, { merge: true });
  const r = await analyzeAdjustment(db, { user: { uid: "mgrN", role: "manager", municipalityId: "north", name: "mgrN" }, municipalityId: "north", roadMatrix: async () => { throw new Error("OSRM down"); } });
  const a = await analysis(r.id);
  ok(a.routingStatus === "failed", `routing ${a.routingStatus}`);
  ok(a.dataQuality.some((q) => q.code === "ROUTING_FAILED"), "not labelled");
  ok(a.status === "PROPOSED", "analysis failed");
  // Approval with the routing service still down re-verifies on the same estimates.
  const ap = await approveAdjustment(db, { user: { uid: "mgrN", role: "manager", municipalityId: "north", name: "mgrN" }, analysisId: r.id, alternativeId: a.recommendedId, roadMatrix: async () => null });
  ok(ap.status === "APPROVED", "approve with fallback");
  await db.doc("dispatch_settings/config").set({ useRoadNetwork: false }, { merge: true });
});
await test("rules: analyses are server-written; read in-municipality only; never by drivers or other municipalities", async () => {
  const id = (await db.collection("adjustment_analyses").limit(1).get()).docs[0].id;
  const ops = await client("opsN"); const mgrE = await client("mgrE"); const drv = await client("D2");
  let readOk = false; try { readOk = (await getDoc(doc(ops, `adjustment_analyses/${id}`))).exists(); } catch (e) { throw new Error("ops cannot read: " + e.message); }
  ok(readOk, "ops cannot read");
  let denied = 0;
  for (const f of [() => getDoc(doc(mgrE, `adjustment_analyses/${id}`)), () => getDoc(doc(drv, `adjustment_analyses/${id}`)), () => updateDoc(doc(ops, `adjustment_analyses/${id}`), { status: "APPROVED" }), () => setDoc(doc(ops, "adjustment_analyses/forged"), { municipalityId: "north", status: "APPROVED" })]) {
    try { await f(); } catch { denied += 1; }
  }
  ok(denied === 4, `denied ${denied}/4`);
  await Promise.all([terminate(ops), terminate(mgrE), terminate(drv)]);
});

console.log(`\nOperational adjustment: ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
