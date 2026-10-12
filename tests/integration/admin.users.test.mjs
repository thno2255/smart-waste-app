/* global process */
/**
 * Trusted server path for sensitive user changes (/api/admin/users) + security backfill migration.
 * Isolated emulators (Firestore with the real firestore.rules + Auth):
 *   npm run test:admin
 * Proves: only an ACTIVE Amanah decision maker can change role / status / municipality; nobody can change their
 * own role or status; scoped roles require a valid municipality; the change is audited by the SERVER; the same
 * change is impossible from any client SDK; transfers re-home the driver account only for an executed transfer;
 * the migration is dry-run by default, idempotent, and scopes documents so scoped staff can see them.
 */
process.env.GCLOUD_PROJECT ||= "swm-admin-test";
const { adminDb, adminAuth } = await import("../../api/_lib/firebaseAdmin.mjs");
const handler = (await import("../../api/admin/users.js")).default;
const { backfillSecurityScope } = await import("../../scripts/migrations/backfill-security-scope.mjs");
const { initializeApp } = await import("firebase/app");
const { getAuth, connectAuthEmulator, signInWithEmailAndPassword } = await import("firebase/auth");
const { getFirestore, connectFirestoreEmulator, doc, updateDoc, getDocs, collection, query, where, terminate } = await import("firebase/firestore");

const db = adminDb();
const PW = "pw-admin-123456";
let passed = 0, failed = 0;
const ok = (c, m) => { if (!c) throw new Error(m); };
async function test(name, fn) { try { await fn(); passed++; console.log("  ✓", name); } catch (e) { failed++; console.log("  ✗", name, "\n     ", e.message); } }
const [fsHost, fsPort] = process.env.FIRESTORE_EMULATOR_HOST.split(":");

async function mkUser(uid, data) {
  await adminAuth().createUser({ uid, email: `${uid}@adm.local`, password: PW }).catch(() => {});
  await db.doc(`users/${uid}`).set({ uid, fullName: uid, ...data });
}
async function token(uid) {
  const r = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: `${uid}@adm.local`, password: PW, returnSecureToken: true }) });
  return (await r.json()).idToken;
}
async function call(uid, body) {
  let code = 0, out = null;
  const res = { setHeader() {}, status(c) { code = c; return res; }, json(o) { out = o; } };
  await handler({ method: "POST", headers: uid ? { authorization: `Bearer ${await token(uid)}` } : {}, body }, res);
  return { code, out };
}
async function client(uid) {
  const app = initializeApp({ apiKey: "fake", projectId: process.env.GCLOUD_PROJECT }, uid);
  const auth = getAuth(app); connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true });
  const fs = getFirestore(app); connectFirestoreEmulator(fs, fsHost, Number(fsPort));
  await signInWithEmailAndPassword(auth, `${uid}@adm.local`, PW);
  return fs;
}

for (const c of ["users", "audit_log", "driver_profiles", "resource_transfers", "requests", "citizen_reports", "alerts", "iot_devices", "bins", "neighborhoods", "collection_routes", "vehicles", "collection_events", "vehicle_status_history"]) {
  const s = await db.collection(c).get(); if (!s.empty) { const b = db.batch(); s.docs.forEach((d) => b.delete(d.ref)); await b.commit(); }
}
await mkUser("amanah", { role: "executive", status: "active" });
await mkUser("amanahOff", { role: "executive", status: "suspended" });
await mkUser("mgrE", { role: "manager", status: "active", municipalityId: "east" });
await mkUser("opsE", { role: "employee", status: "active", municipalityId: "east" });
await mkUser("drvE", { role: "driver", status: "active", municipalityId: "east" });
await mkUser("newEmp", { role: "employee", status: "pending", municipalityId: null });
await db.doc("driver_profiles/drvE").set({ uid: "drvE", municipalityId: "east" });

console.log("\nTrusted admin path + migration (emulator)");

await test("only an ACTIVE Amanah decision maker may call the route (no token 401 · ops/manager/driver/suspended 403)", async () => {
  ok((await call(null, { action: "setRole", uid: "drvE", role: "manager" })).code === 401, "no token");
  for (const u of ["opsE", "mgrE", "drvE", "amanahOff"]) ok((await call(u, { action: "setRole", uid: "drvE", role: "manager" })).code === 403, `${u} not 403`);
  ok((await db.doc("users/drvE").get()).get("role") === "driver", "role changed by a non-admin");
});

await test("nobody changes their own role or status — not even the Amanah", async () => {
  ok((await call("amanah", { action: "setRole", uid: "amanah", role: "citizen" })).code === 409, "self role");
  ok((await call("amanah", { action: "setStatus", uid: "amanah", status: "suspended" })).code === 409, "self status");
});

await test("scoped roles need a valid municipality: activating/promoting an account without one is refused", async () => {
  ok((await call("amanah", { action: "setStatus", uid: "newEmp", status: "active" })).code === 409, "activated without municipality");
  ok((await call("amanah", { action: "setMunicipality", uid: "newEmp", municipalityId: "atlantis" })).code === 400, "unknown municipality accepted");
  ok((await call("amanah", { action: "setMunicipality", uid: "newEmp", municipalityId: "east" })).code === 200, "set municipality");
  ok((await call("amanah", { action: "setStatus", uid: "newEmp", status: "active" })).code === 200, "activate");
  ok((await call("amanah", { action: "setRole", uid: "newEmp", role: "superuser" })).code === 400, "invalid role accepted");
});

await test("the Amanah changes role and municipality through the server; the driver profile follows; the SERVER writes the audit", async () => {
  ok((await call("amanah", { action: "setRole", uid: "opsE", role: "manager" })).code === 200, "setRole");
  ok((await db.doc("users/opsE").get()).get("role") === "manager", "role not written");
  ok((await call("amanah", { action: "setMunicipality", uid: "drvE", municipalityId: "north" })).code === 200, "setMunicipality");
  ok((await db.doc("driver_profiles/drvE").get()).get("municipalityId") === "north", "profile not mirrored");
  const audit = (await db.collection("audit_log").where("source", "==", "server").get()).docs.map((d) => d.data());
  ok(audit.some((a) => a.action === "user_role_changed" && a.actorId === "amanah" && a.details.to === "manager"), "role audit missing");
  ok(audit.some((a) => a.action === "user_municipality_set" && a.details.to === "north"), "municipality audit missing");
  await call("amanah", { action: "setMunicipality", uid: "drvE", municipalityId: "east" });
});

await test("the same changes are refused from the client SDK, even for the Amanah (rules)", async () => {
  for (const [uid, target, patch] of [["amanah", "drvE", { role: "manager" }], ["amanah", "drvE", { municipalityId: "north" }], ["mgrE", "drvE", { status: "suspended" }], ["drvE", "drvE", { role: "executive" }]]) {
    const fs = await client(uid);
    let denied = false; try { await updateDoc(doc(fs, "users", target), patch); } catch { denied = true; }
    await terminate(fs);
    ok(denied, `${uid} → ${target} ${JSON.stringify(patch)} was allowed`);
  }
});

await test("transfers no longer go through this route (one transaction in /api/admin/transfers); a transferred account cannot be re-homed by hand", async () => {
  ok((await call("amanah", { action: "applyTransfer", transferId: "T1" })).code === 400, "legacy applyTransfer accepted");
  ok((await call("amanah", { action: "revertTransfer", transferId: "T1" })).code === 400, "legacy revertTransfer accepted");
  await db.doc("users/drvE").update({ transferId: "T1" });
  ok((await call("amanah", { action: "setMunicipality", uid: "drvE", municipalityId: "north" })).code === 409, "re-homed during a transfer");
  await db.doc("users/drvE").update({ transferId: null });
});

await test("migration: dry run writes nothing + reports; apply needs a backup; counts verified; re-run is a no-op; restore undoes only its own fields; accounts are reported, never changed", async () => {
  const { restoreBackup } = await import("../../scripts/migrations/backfill-security-scope.mjs");
  const { mkdtempSync, readFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  await db.doc("neighborhoods/nE").set({ name: "حي الشروق", municipalityId: "east" });
  await db.doc("bins/bE").set({ name: "bE", municipalityId: "east", neighborhoodId: "nE" });
  await db.doc("requests/r1").set({ userId: "c1", district: "حي الشروق" });
  await db.doc("requests/r2").set({ userId: "c2", district: "حي غير معروف" });
  await db.doc("citizen_reports/c1").set({ userId: "c1", district: "", binId: "bE" });
  await db.doc("alerts/a1").set({ sourceId: "bE", resolved: false });
  await db.doc("iot_devices/d1").set({ deviceId: "ESP-1", binId: "bE" });
  await db.doc("users/legacy1").set({ role: "employee", status: "approved" });
  const usersBefore = JSON.stringify((await db.collection("users").get()).docs.map((d) => [d.id, d.data()]).sort());

  const dry = await backfillSecurityScope(db, { apply: false });
  ok(dry.mode === "dry-run" && dry.report.requests.toWrite === 1 && dry.report.requests.unresolved === 1 && dry.report.requests.written === 0 && dry.ok, `dry: ${JSON.stringify(dry.report.requests)}`);
  ok(!(await db.doc("requests/r1").get()).get("municipalityId"), "dry run modified data");
  let refused = false; try { await backfillSecurityScope(db, { apply: true }); } catch { refused = true; }
  ok(refused, "apply ran without a backup");

  const dir = mkdtempSync(`${tmpdir()}/swm-mig-`);
  const run = await backfillSecurityScope(db, { apply: true, backupDir: dir, now: "2026-10-12T00:00:00.000Z" });
  ok(run.ok && run.report.requests.written === 1 && run.report.citizen_reports.written === 1 && run.report.alerts.written === 1 && run.report.iot_devices.written === 1, `apply: ${JSON.stringify(run.report)}`);
  ok(Object.values(run.verification).every((v) => v.countUnchanged && v.scopedAsExpected), "count verification failed");
  ok(JSON.parse(readFileSync(run.backupFile, "utf8")).changes.length === 4, "backup incomplete");
  ok(!(await db.doc("requests/r2").get()).get("municipalityId"), "unresolved doc was guessed");
  const again = await backfillSecurityScope(db, { apply: true, backupDir: dir });
  ok(Object.values(again.report).every((r) => r.written === 0) && again.backupFile === null, "second run wrote again");

  await mkUser("opsE2", { role: "employee", status: "active", municipalityId: "east" });
  const fs = await client("opsE2");
  ok((await getDocs(query(collection(fs, "requests"), where("municipalityId", "==", "east")))).size === 1, "scoped staff cannot see the backfilled request");
  await terminate(fs);

  await db.doc("alerts/a1").update({ municipalityId: "north" });   // edited after the migration → restore must leave it
  const res = await restoreBackup(db, run.backupFile);
  ok(res.restored === 3 && res.skippedChanged === 1, `restore: ${JSON.stringify(res)}`);
  ok(!(await db.doc("requests/r1").get()).get("municipalityId") && !(await db.doc("requests/r1").get()).get("municipalityBackfilledAt"), "restore left fields");
  ok((await db.doc("alerts/a1").get()).get("municipalityId") === "north", "restore overwrote a later edit");

  ok(run.users.statusApproved.some((u) => u.uid === "legacy1") && run.users.staffWithoutMunicipality.some((u) => u.uid === "legacy1"), "account review missed legacy1");
  const usersAfter = JSON.stringify((await db.collection("users").get()).docs.filter((d) => d.id !== "opsE2").map((d) => [d.id, d.data()]).sort());
  ok(usersAfter === usersBefore, "migration changed user accounts");
});

console.log(`\nAdmin path + migration: ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
