/* global process */
/**
 * Operational command centre — end-to-end scenario on isolated Firestore + Auth emulators (real rules, real ID tokens):
 *   npm run test:command
 *
 *   1–7   critical bins in one neighbourhood → server cycle studies existing routes and drivers → a driver about to finish
 *         gets the NEXT route reserved → the structured decision record is saved and readable by operations (not drivers)
 *   8–9   the driver sees the reserved task and its expected collection time
 *   10–13 the driver finishes, starts the reserved route, confirms every stop through the server → performance and
 *         impact are computed from the stored data (realised, against the reference route)
 *   14–18 another neighbourhood has no capacity → escalation with a resource-gap analysis: the ladder of measures,
 *         the extra crew simulated with the same engine, before/after vs the target, and the reason
 *   + repeated cycle (no duplicates), routing service down (labelled estimate), shift ending (never assigned).
 */
process.env.GCLOUD_PROJECT ||= "swm-command-test";
const { adminDb, adminAuth } = await import("../../api/_lib/firebaseAdmin.mjs");
const { runDispatchCycle } = await import("../../api/_lib/dispatchRunner.mjs");
const confirmHandler = (await import("../../api/field/confirm-collection.js")).default;
const { operationalImpact, explanationSummary } = await import("../../src/decisionExplain.js");
const { initializeApp } = await import("firebase/app");
const { getAuth, connectAuthEmulator, signInWithEmailAndPassword } = await import("firebase/auth");
const { getFirestore, connectFirestoreEmulator, doc, getDoc, updateDoc, terminate } = await import("firebase/firestore");

const db = adminDb();
const PW = "pw-command-123456";
let passed = 0, failed = 0;
const ok = (c, m) => { if (!c) throw new Error(m); };
async function test(name, fn) { try { await fn(); passed++; console.log("  ✓", name); } catch (e) { failed++; console.log("  ✗", name, "\n     ", e.message); } }
const [fsHost, fsPort] = process.env.FIRESTORE_EMULATOR_HOST.split(":");
const iso = (ms) => new Date(ms).toISOString();
const fresh = () => iso(Date.now() - 60000);

async function wipe() {
  for (const c of ["bins", "neighborhoods", "driver_profiles", "vehicles", "collection_routes", "collection_events", "route_incidents", "dispatch_decisions", "dispatch_runs", "dispatch_locks", "dispatch_settings", "driver_notifications", "audit_log", "municipalities", "rate_limits", "simulated_readings", "sensor_readings"]) {
    const s = await db.collection(c).get(); if (!s.empty) { const b = db.batch(); s.docs.forEach((d) => b.delete(d.ref)); await b.commit(); }
  }
}
async function mkUser(uid, data) { await adminAuth().createUser({ uid, email: `${uid.toLowerCase()}@c.local`, password: PW }).catch(() => {}); await db.doc(`users/${uid}`).set({ uid, fullName: uid, status: "active", ...data }); }
const tokens = {};
async function token(uid) {
  if (tokens[uid]) return tokens[uid];
  const r = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: `${uid.toLowerCase()}@c.local`, password: PW, returnSecureToken: true }) });
  return (tokens[uid] = (await r.json()).idToken);
}
async function client(uid) {
  const app = initializeApp({ apiKey: "fake", projectId: process.env.GCLOUD_PROJECT }, uid + Math.random());
  const auth = getAuth(app); connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true });
  const fs = getFirestore(app); connectFirestoreEmulator(fs, fsHost, Number(fsPort));
  await signInWithEmailAndPassword(auth, `${uid.toLowerCase()}@c.local`, PW);
  return fs;
}
async function confirm(uid, body) {
  let code = 0, out = null; const res = { setHeader() {}, status(c) { code = c; return res; }, json(o) { out = o; } };
  await confirmHandler({ method: "POST", headers: { authorization: `Bearer ${await token(uid)}` }, body }, res);
  return { code, out };
}
const bin = (id, nid, fill, lat, lng) => ({ name: id, neighborhoodId: nid, municipalityId: "east", deviceId: "d" + id, lastFillLevelPercent: fill, lastTemperatureCelsius: 28, lastReadingAt: fresh(), lat, lng, capacityLiters: 1100, demo: true, simulated: true });
const settings = (extra = {}) => db.doc("dispatch_settings/config").set({ mode: "auto", scope: "demo_only", periodMinutes: 15, useRoadNetwork: false, ...extra });
const decisions = async () => (await db.collection("dispatch_decisions").get()).docs.map((d) => ({ id: d.id, ...d.data() }));

async function seed() {
  await wipe();
  const b = db.batch();
  b.set(db.doc("municipalities/east"), { id: "east" });
  b.set(db.doc("neighborhoods/n1"), { name: "حي الخليج", municipalityId: "east" });
  b.set(db.doc("neighborhoods/n2"), { name: "حي الشروق", municipalityId: "east" });
  b.set(db.doc("neighborhoods/n3"), { name: "حي الريان", municipalityId: "east" });
  [["k1", 92], ["k2", 90], ["k3", 88]].forEach(([id, f], i) => b.set(db.doc(`bins/${id}`), bin(id, "n1", f, 26.360 + i * 0.001, 43.970 + i * 0.001)));
  [["r1", 96], ["r2", 94], ["r3", 91]].forEach(([id, f], i) => b.set(db.doc(`bins/${id}`), bin(id, "n3", f, 26.400 + i * 0.001, 43.900 + i * 0.001)));
  b.set(db.doc("bins/p0"), bin("p0", "n2", 30, 26.330, 44.040));
  // D1 is finishing a route in progress (one stop left); D2 is idle but its depot is ~12 km away. Nobody covers الريان.
  b.set(db.doc("driver_profiles/D1"), { uid: "D1", fullName: "سائق الشرق 1", accountStatus: "active", shiftStatus: "on_shift", availability: "available", vehicleId: "VD1", neighborhoodKeys: ["الخليج", "الشروق"], municipalityId: "east" });
  b.set(db.doc("driver_profiles/D2"), { uid: "D2", fullName: "سائق الشرق 2", accountStatus: "active", shiftStatus: "on_shift", availability: "available", vehicleId: "VD2", neighborhoodKeys: ["الخليج"], municipalityId: "east" });
  b.set(db.doc("vehicles/VD1"), { vehicleNumber: "مركبة 1", status: "on_route", capacityLiters: 8000, depotLat: 26.33, depotLng: 43.95, municipalityId: "east", driverId: "D1" });
  b.set(db.doc("vehicles/VD2"), { vehicleNumber: "مركبة 2", status: "available", capacityLiters: 8000, depotLat: 26.42, depotLng: 44.05, municipalityId: "east", driverId: "D2" });
  b.set(db.doc("collection_routes/RUN"), { routeName: "جولة الشروق", municipalityId: "east", status: "in_progress", driverId: "D1", driverName: "سائق الشرق 1", vehicleId: "VD1", neighborhoodIds: ["n2"], binIds: ["p0"],
    orderedStops: [{ order: 1, binId: "p0", lat: 26.330, lng: 44.040 }], collectedBinIds: [], skippedStops: [], estimatedWasteLiters: 400, approvedAt: iso(Date.now() - 3600000), startedAt: iso(Date.now() - 1800000), demo: true });
  await b.commit();
}

await mkUser("opsE", { role: "employee", municipalityId: "east" });
await mkUser("D1", { role: "driver", municipalityId: "east" });
await mkUser("D2", { role: "driver", municipalityId: "east" });

console.log("\nOperational command centre — scenario (emulator)");
await seed(); await settings();
const cycle = await runDispatchCycle(db, { trigger: "manual" });
let assignment, route, gapDecision;

await test("1–6 · critical bins → existing routes and drivers studied → the driver finishing soon gets the NEXT route reserved, with a saved structured record", async () => {
  const decs = await decisions();
  assignment = decs.find((d) => d.type === "create_assign" && d.neighborhoodId === "n1");
  ok(assignment && assignment.status === "executed", `no executed assignment: ${JSON.stringify(cycle.municipalities.east)}`);
  ok(assignment.driverId === "D1" && assignment.reservation?.afterRouteId === "RUN", `driver ${assignment.driverId}, reservation ${JSON.stringify(assignment.reservation)}`);
  const e = assignment.explanation;
  ok(e?.v === 1 && e.decisionType === "NEXT_ROUTE_RESERVATION", "no structured record");
  ok(e.trigger.bins.length === 3 && e.trigger.code === "CRITICAL_FILL", "trigger not recorded");
  ok(e.candidates.evaluated === 2 && e.candidates.excluded.some((x) => x.driverId === "D2" && x.codes.includes("LATER_ETA")), "exclusions not recorded");
  ok(e.alternatives.find((a) => a.option === "RESERVE_NEXT_ROUTE").chosen === true, "alternatives not recorded");
  ok(e.timing.etaMin > 0 && e.timing.completionMin > e.timing.etaMin && e.dataSources.fill === "simulated", "timing / sources missing");
  ok(explanationSummary(e).includes("حُجزت الجولة التالية"), "summary not derived from codes");
  route = { id: assignment.routeId, ...(await db.doc(`collection_routes/${assignment.routeId}`).get()).data() };
  ok(route.status === "approved" && route.dispatch.reservedAfterRouteId === "RUN" && route.dispatch.explanation?.v === 1 && route.expectedCollectionAt, "route does not carry the reservation / record");
});

await test("7 · operations reads the decision and its record (rules); a driver cannot read decision records", async () => {
  const ops = await client("opsE");
  const d = await getDoc(doc(ops, "dispatch_decisions", assignment.id));
  ok(d.exists() && d.data().explanation?.selection?.driverId === "D1", "operations cannot read the record");
  await terminate(ops);
  const drv = await client("D1");
  let denied = false; try { await getDoc(doc(drv, "dispatch_decisions", assignment.id)); } catch { denied = true; }
  await terminate(drv);
  ok(denied, "driver read a decision record");
});

await test("8–9 · the driver is notified of the reserved task and sees its expected collection time", async () => {
  const notes = (await db.collection("driver_notifications").where("driverId", "==", "D1").get()).docs.map((d) => d.data());
  ok(notes.some((n) => n.type === "route_reserved" && n.routeId === route.id), "no reservation notification");
  const drv = await client("D1");
  const r = await getDoc(doc(drv, "collection_routes", route.id));
  await terminate(drv);
  ok(r.exists() && r.data().expectedCollectionAt && r.data().dispatch.expectedStartAt, "driver cannot see the reserved route timing");
});

await test("repeated cycle → no duplicate route, no duplicate reservation", async () => {
  await runDispatchCycle(db, { trigger: "manual" });
  const routes = (await db.collection("collection_routes").where("dispatch.reservedAfterRouteId", "==", "RUN").get()).size;
  ok(routes === 1, `${routes} reserved routes`);
  ok((await decisions()).filter((d) => d.type === "create_assign" && d.status === "executed").length === 1, "assignment executed twice");
});

await test("14–18 · no capacity in another neighbourhood → escalation with a resource-gap analysis (ladder, simulated extra crew, before/after vs target, reason)", async () => {
  gapDecision = (await decisions()).find((d) => d.type === "escalate" && d.neighborhoodId === "n3");
  ok(gapDecision && gapDecision.status === "open", "no open escalation for الريان");
  const g = gapDecision.gap;
  ok(g?.v === 1 && g.options.length === 7, "no gap analysis");
  ok(g.options.map((o) => o.code).join() === "OPTIMIZE_EXISTING_ROUTES,REDISTRIBUTE_TASKS,DRIVER_FINISHING_SOON,SHIFT_TIMING,VEHICLE_REDISTRIBUTION,INTER_MUNICIPALITY_SUPPORT,ADD_RESOURCES", "ladder order");
  const add = g.options.find((o) => o.code === "ADD_RESOURCES");
  ok(add.feasible === true && add.expected.afterMin > 0 && add.expected.targetMin === 60, `extra crew not simulated: ${JSON.stringify(add.expected)}`);
  ok(g.beforeMin === null && g.demand.binsCount === 3 && g.capacity.coveringDrivers === 0, "before / demand / capacity");
  ok(g.recommendedStep != null && g.problem.includes("الريان") && add.cause, "no reason / recommendation");
  ok(gapDecision.explanation?.candidates?.excluded.every((x) => x.codes.includes("OUTSIDE_COVERAGE")), "escalation record");
});

await test("10–13 · driver finishes, starts the reserved route, confirms every stop through the server → realised performance and impact from stored data", async () => {
  const drv = await client("D1");
  await updateDoc(doc(drv, "collection_routes", "RUN"), { status: "completed", completedAt: iso(Date.now()), updatedAt: iso(Date.now()) });
  await updateDoc(doc(drv, "collection_routes", route.id), { status: "in_progress", startedAt: iso(Date.now()), updatedAt: iso(Date.now()) });
  await terminate(drv);
  for (const s of route.orderedStops) {
    const r = await confirm("D1", { routeId: route.id, binId: s.binId });
    ok(r.code === 200 && r.out.duplicate === false, `confirm ${s.binId}: ${r.code} ${JSON.stringify(r.out)}`);
  }
  const drv2 = await client("D1");
  await updateDoc(doc(drv2, "collection_routes", route.id), { status: "completed", completedAt: iso(Date.now()), updatedAt: iso(Date.now()) });
  await terminate(drv2);
  const [routes, events, decs, vehicles] = await Promise.all(["collection_routes", "collection_events", "dispatch_decisions", "vehicles"].map(async (c) => (await db.collection(c).get()).docs.map((d) => ({ id: d.id, ...d.data() }))));
  const imp = operationalImpact({ routes, events, decisions: decs, vehicles, targets: { criticalCollectionMin: 60 } });
  ok(imp.realised.binsCollected === 3 && imp.realised.routesCompleted === 2, `collected ${imp.realised.binsCollected}, completed ${imp.realised.routesCompleted}`);
  ok(imp.realised.autoDecisionsSucceeded === 1, "auto decision not counted as succeeded");
  ok(imp.realised.kmSaved != null && imp.realised.fuelL != null && imp.realised.co2Kg != null, "impact not computed");
  ok(imp.realised.onTimePct === 100 && imp.realised.avgResponseMin != null, "response / on-time not computed");
  ok(imp.realised.utilizationPct > 0, "utilisation not computed");
});

await test("routing service down → assignment still made on a labelled estimate", async () => {
  await seed(); await settings({ useRoadNetwork: true });
  await runDispatchCycle(db, { trigger: "manual", roadMatrix: async () => { throw new Error("osrm down"); } });
  const a = (await decisions()).find((d) => d.type === "create_assign");
  ok(a && a.explanation.dataSources.approach === "estimate_routing_failed", `approach source ${a?.explanation?.dataSources?.approach}`);
});

await test("a shift that ends before the work would finish → never assigned; the record says why", async () => {
  await seed();
  const local = new Date(Date.now() + 180 * 60000);
  const hhmm = (d) => `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  await db.doc("collection_routes/RUN").delete();
  await db.doc("driver_profiles/D1").update({ shiftStart: hhmm(new Date(local.getTime() - 3600000)), shiftEnd: hhmm(new Date(local.getTime() + 5 * 60000)) });
  await db.doc("driver_profiles/D2").update({ shiftStatus: "off_shift" });
  await settings();
  await runDispatchCycle(db, { trigger: "manual" });
  const decs = await decisions();
  ok(!decs.some((d) => d.type === "create_assign" && d.neighborhoodId === "n1"), "assigned beyond the shift");
  const esc = decs.find((d) => d.type === "escalate" && d.neighborhoodId === "n1");
  ok(esc?.explanation?.candidates?.excluded.find((x) => x.driverId === "D1")?.codes.includes("SHIFT_ENDS_BEFORE_COMPLETION"), "shift exclusion not recorded");
});

console.log(`\nCommand centre: ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
