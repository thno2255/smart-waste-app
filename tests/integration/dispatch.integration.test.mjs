/* global process */
/**
 * Autonomous dispatch — integration tests against the Firestore + Auth emulators (no cloud access).
 *   firebase emulators:exec --only firestore,auth --project swm-dispatch-test "node tests/integration/dispatch.integration.test.mjs"
 * or with emulators already running: FIRESTORE_EMULATOR_HOST=… FIREBASE_AUTH_EMULATOR_HOST=… GCLOUD_PROJECT=swm-dispatch-test node …
 *
 * Proves, end to end through the real runner and real transactions:
 *   observe mode changes nothing · demo_only never touches real bins · execution writes route + notification + audit
 *   · idempotency on re-run · two CONCURRENT cycles never double-assign · insert-first · reassignment on shift change
 *   · the HTTP endpoint's authorisation (cron secret, staff token, municipality scoping, citizen denied).
 */
process.env.GCLOUD_PROJECT ||= "swm-dispatch-test";
process.env.CRON_SECRET = "test-cron-secret";
const { adminDb, adminAuth } = await import("../../api/_lib/firebaseAdmin.mjs");
const { runDispatchCycle } = await import("../../api/_lib/dispatchRunner.mjs");
const handler = (await import("../../api/dispatch/run.js")).default;

const db = adminDb();
let passed = 0, failed = 0;
const ok = (cond, msg) => { if (!cond) throw new Error(msg); };
async function test(name, fn) { try { await fn(); passed++; console.log("  ✓", name); } catch (e) { failed++; console.log("  ✗", name, "\n     ", e.message); } }

const now = Date.now();
const fresh = new Date(now - 60000).toISOString();
async function wipe() {
  for (const c of ["bins", "neighborhoods", "driver_profiles", "vehicles", "collection_routes", "route_incidents", "dispatch_decisions", "dispatch_runs", "dispatch_locks", "dispatch_settings", "driver_notifications", "audit_log", "users", "municipalities", "simulated_readings", "sensor_readings", "fire_sensors", "citizen_reports"]) {
    const snap = await db.collection(c).get(); const b = db.batch(); snap.docs.forEach((d) => b.delete(d.ref)); if (!snap.empty) await b.commit();
  }
}
const bin = (id, nid, fill, i, extra = {}) => ({ name: id, neighborhoodId: nid, municipalityId: "east", deviceId: "d" + id, lastFillLevelPercent: fill, lastTemperatureCelsius: 28, lastReadingAt: fresh, lat: (nid === "n1" ? 26.360 : 26.330) + i * 0.001, lng: (nid === "n1" ? 43.970 : 44.040) + i * 0.001, capacityLiters: 1100, demo: true, ...extra });
async function seed({ realBins = false } = {}) {
  await wipe();
  const b = db.batch();
  b.set(db.doc("municipalities/east"), { id: "east" });
  b.set(db.doc("neighborhoods/n1"), { name: "حي الخليج", municipalityId: "east" });
  b.set(db.doc("neighborhoods/n2"), { name: "حي الشروق", municipalityId: "east" });
  [["k1", 92], ["k2", 90], ["k3", 88]].forEach(([id, f], i) => b.set(db.doc(`bins/${id}`), bin(id, "n1", f, i)));
  [["s1", 95], ["s2", 93], ["s3", 90]].forEach(([id, f], i) => b.set(db.doc(`bins/${id}`), bin(id, "n2", f, i, realBins ? { demo: false } : {})));
  for (const d of ["D1", "D2"]) {
    b.set(db.doc(`driver_profiles/${d}`), { uid: d, fullName: `سائق ${d}`, accountStatus: "active", shiftStatus: "on_shift", availability: "available", vehicleId: `V${d}`, neighborhoodKeys: ["الخليج", "الشروق"], municipalityId: "east" });
    b.set(db.doc(`vehicles/V${d}`), { vehicleNumber: `مركبة ${d}`, status: "available", capacityLiters: 8000, depotLat: 26.33, depotLng: 43.95, municipalityId: "east" });
  }
  await b.commit();
}
const setMode = (mode, scope = "demo_only", extra = {}) => db.doc("dispatch_settings/config").set({ mode, scope, periodMinutes: 15, ...extra });
const active = async () => (await db.collection("collection_routes").where("status", "in", ["approved", "in_progress"]).get()).docs.map((d) => ({ id: d.id, ...d.data() }));

console.log("\nAutonomous dispatch — integration (emulator)");

await test("observe mode: decisions are recorded as 'observed' and NO route is created or changed", async () => {
  await seed(); await setMode("observe");
  const r = await runDispatchCycle(db, { trigger: "manual" });
  ok(r.municipalities.east.observed >= 2, `observed=${r.municipalities.east.observed}`);
  ok((await db.collection("collection_routes").get()).size === 0, "routes were created in observe mode");
  const decs = (await db.collection("dispatch_decisions").get()).docs.map((d) => d.data());
  ok(decs.every((d) => d.status === "observed"), "a decision is not 'observed'");
  ok(decs.some((d) => d.type === "create_assign" && d.driverId && d.reason.includes("ضمن النطاق")), "no explained assignment decision");
});

await test("auto + demo_only: real bins are never executed (recorded as out of scope)", async () => {
  await seed({ realBins: true }); await setMode("auto", "demo_only");
  const r = await runDispatchCycle(db, { trigger: "manual" });
  const routes = await active();
  ok(routes.length === 1, `expected 1 executed route (demo neighborhood), got ${routes.length}`);
  ok(routes[0].binIds.every((id) => id.startsWith("k")), "a real bin was dispatched");
  ok(r.municipalities.east.outOfScope >= 1, "out-of-scope not counted");
});

await test("auto execution: approved route with reason, driver notification, audit entry and executed decision", async () => {
  await seed(); await setMode("auto");
  const r = await runDispatchCycle(db, { trigger: "manual" });
  const routes = await active();
  ok(routes.length === 2, `expected 2 routes, got ${routes.length}`);
  ok(new Set(routes.map((x) => x.driverId)).size === 2, "same driver got two routes");
  ok(routes.every((x) => x.dispatch?.auto === true && x.approvedBy === "system:auto-dispatch" && x.dispatch.reason), "missing dispatch metadata");
  const notes = (await db.collection("driver_notifications").get()).docs.map((d) => d.data());
  ok(notes.length === 2 && notes.every((n) => n.type === "route_assigned" && !n.read), "notifications missing");
  const audit = (await db.collection("audit_log").where("action", "==", "route_auto_assigned").get()).size;
  ok(audit === 2, `audit=${audit}`);
  ok(r.municipalities.east.executed === 2, `executed=${r.municipalities.east.executed}`);
});

await test("idempotency: re-running the same cycle creates nothing new", async () => {
  const before = (await db.collection("collection_routes").get()).size;
  const r = await runDispatchCycle(db, { trigger: "manual" });
  ok((await db.collection("collection_routes").get()).size === before, "duplicate route created");
  ok(r.municipalities.east.executed === 0, `executed again: ${r.municipalities.east.executed}`);
});

await test("concurrency: two cycles started at the same instant never double-assign a bin or a driver", async () => {
  await seed(); await setMode("auto");
  const [a, b] = await Promise.all([runDispatchCycle(db, { trigger: "manual", now }), runDispatchCycle(db, { trigger: "manual", now })]);
  const routes = await active();
  const allBins = routes.flatMap((x) => x.binIds);
  ok(allBins.length === new Set(allBins).size, "a bin is on two active routes");
  ok(routes.length === new Set(routes.map((x) => x.driverId)).size, "a driver holds two active routes");
  ok(routes.length === 2, `routes=${routes.length}`);
  const ex = a.municipalities.east.executed + b.municipalities.east.executed;
  ok(ex === 2, `total executed ${ex} (expected 2: the loser sees duplicates)`);
});

await test("insert first: a new critical bin next to an assigned route joins that route", async () => {
  const before = (await active()).find((x) => x.neighborhoodIds[0] === "n1");
  await db.doc("bins/k9").set(bin("k9", "n1", 94, 1.5));
  await runDispatchCycle(db, { trigger: "manual" });
  const after = (await db.doc(`collection_routes/${before.id}`).get()).data();
  ok(after.binIds.includes("k9"), "k9 not inserted");
  ok(after.binIds.length === before.binIds.length + 1, "route size wrong");
  ok((await active()).length === 2, "a new route was created instead of inserting");
  const n = (await db.collection("driver_notifications").where("type", "==", "stop_added").get()).size;
  ok(n === 1, `stop_added notifications=${n}`);
});

await test("re-evaluation: driver goes off shift → auto route reassigned to the free driver (or released + escalated)", async () => {
  await seed(); await setMode("auto");
  await db.doc("driver_profiles/D2").update({ shiftStatus: "off_shift" });   // only D1 works → one route, other escalated
  await runDispatchCycle(db, { trigger: "manual" });
  const r1 = (await active())[0];
  ok(r1.driverId === "D1", "expected D1");
  await db.doc("driver_profiles/D1").update({ shiftStatus: "off_shift" });
  await db.doc("driver_profiles/D2").update({ shiftStatus: "on_shift" });
  await runDispatchCycle(db, { trigger: "manual" });
  const r1b = (await db.doc(`collection_routes/${r1.id}`).get()).data();
  ok(r1b.driverId === "D2", `expected reassignment to D2, got ${r1b.driverId}`);
  ok((r1b.dispatch.reassignments || []).length === 1, "reassignment not logged");
  const esc = (await db.collection("dispatch_decisions").where("status", "==", "open").get()).docs.map((d) => d.data().kind);
  ok(esc.includes("no_driver"), `expected a no_driver escalation, got ${esc.join(",")}`);
});

await test("mode off: the cycle does nothing; periodic trigger respects periodMinutes", async () => {
  await setMode("off");
  ok((await runDispatchCycle(db, { trigger: "manual" })).skipped === "off", "off not honoured");
  await setMode("observe", "demo_only", { lastRunAt: new Date(now - 60000).toISOString() });
  ok((await runDispatchCycle(db, { trigger: "cron", now })).skipped === "not_due", "period not honoured");
  ok(!(await runDispatchCycle(db, { trigger: "critical_reading", municipalityId: "east", now })).skipped, "urgent trigger must bypass the period");
});

await test("HTTP endpoint authorisation: cron secret ok · no token 401 · citizen 403 · manager limited to own municipality", async () => {
  const call = async (headers, body = {}, method = "POST") => { let code = 0, out = null; const res = { setHeader() {}, status(c) { code = c; return res; }, json(o) { out = o; } }; await handler({ method, headers, body }, res); return { code, out }; };
  ok((await call({}, {}, "GET")).code === 401, "no token should be 401");
  ok((await call({ authorization: "Bearer test-cron-secret" }, {}, "GET")).code === 200, "cron secret rejected");
  const auth = adminAuth();
  const mk = async (uid, role, municipalityId) => { await auth.createUser({ uid, email: `${uid}@t.local`, password: "pw-123456" }).catch(() => {}); await db.doc(`users/${uid}`).set({ role, status: "active", municipalityId: municipalityId || null, fullName: uid }); };
  await mk("cit", "citizen"); await mk("mgrE", "manager", "east");
  const token = async (uid) => { const r = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: `${uid}@t.local`, password: "pw-123456", returnSecureToken: true }) }); return (await r.json()).idToken; };
  ok((await call({ authorization: `Bearer ${await token("cit")}` })).code === 403, "citizen allowed");
  ok((await call({ authorization: `Bearer ${await token("mgrE")}` }, { municipalityId: "north" })).code === 403, "manager reached another municipality");
  const own = await call({ authorization: `Bearer ${await token("mgrE")}` }, { trigger: "simulator_event" });
  ok(own.code === 200 && (own.out.skipped || own.out.municipalities), `manager own municipality failed: ${own.code} ${JSON.stringify(own.out).slice(0, 120)}`);
});


await test("a newer escalation of the same issue supersedes the older open one (no duplicates for operations)", async () => {
  await seed(); await setMode("auto");
  await db.doc("driver_profiles/D1").update({ shiftStatus: "off_shift" }); await db.doc("driver_profiles/D2").update({ shiftStatus: "off_shift" });
  await runDispatchCycle(db, { trigger: "manual" });
  const first = (await db.collection("dispatch_decisions").where("status", "==", "open").get()).docs.filter((d) => d.get("kind") === "no_driver" && d.get("neighborhoodId") === "n1");
  ok(first.length === 1, `expected 1 open no_driver for n1, got ${first.length}`);
  await db.doc("bins/k8").set(bin("k8", "n1", 96, 3));                     // the bin set changes → new key
  await runDispatchCycle(db, { trigger: "manual" });
  const open = (await db.collection("dispatch_decisions").where("status", "==", "open").get()).docs.filter((d) => d.get("kind") === "no_driver" && d.get("neighborhoodId") === "n1");
  ok(open.length === 1, `expected still 1 open, got ${open.length}`);
  ok((await db.doc(`dispatch_decisions/${first[0].id}`).get()).get("status") === "superseded", "old escalation not superseded");
});

console.log(`\nDispatch integration: ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
