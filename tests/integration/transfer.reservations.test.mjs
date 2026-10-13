/* global process */
/**
 * Inter-municipality loans — time-window reservations, conflicts and concurrency (isolated Firestore + Auth emulators).
 *   node "$(firebase)" emulators:exec --only firestore,auth --project swm-reserve-test "node tests/integration/transfer.reservations.test.mjs"
 *
 *   1  two proposals lend the SAME driver to two municipalities in overlapping windows; both approvals run concurrently
 *      → exactly one is approved and reserved, the other is refused (409) — no crew for two municipalities
 *   2  non-overlapping windows on the same driver → both approved
 *   3  approving the same transfer twice is idempotent (one reservation per resource)
 *   4  a non-Amanah account cannot approve (403); an unknown transfer → 404
 *   5  returning a transfer releases its reservations, after which the resource can be approved again
 */
process.env.GCLOUD_PROJECT ||= "swm-reserve-test";
const { adminDb, adminAuth } = await import("../../api/_lib/firebaseAdmin.mjs");
const handler = (await import("../../api/admin/transfers.js")).default;
const { approveTransfer } = await import("../../api/_lib/transfers.mjs");

const db = adminDb();
const PW = "pw-reserve-123456";
let passed = 0, failed = 0;
const ok = (c, m) => { if (!c) throw new Error(m); };
async function test(name, fn) { try { await fn(); passed++; console.log("  ✓", name); } catch (e) { failed++; console.log("  ✗", name, "\n     ", e.message); } }
const iso = (ms) => new Date(ms).toISOString();
const NOW = Date.now();
const tokens = {};
async function mkUser(uid, data) { await adminAuth().createUser({ uid, email: `${uid}@r.local`, password: PW }).catch(() => {}); await db.doc(`users/${uid}`).set({ uid, fullName: uid, status: "active", ...data }); }
async function token(uid) {
  if (tokens[uid]) return tokens[uid];
  const r = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: `${uid}@r.local`, password: PW, returnSecureToken: true }) });
  return (tokens[uid] = (await r.json()).idToken);
}
async function call(uid, body) {
  let code = 0, out = null; const res = { setHeader() {}, status(c) { code = c; return res; }, json(o) { out = o; } };
  await handler({ method: "POST", headers: { authorization: `Bearer ${await token(uid)}` }, body }, res);
  return { code, out };
}
async function wipe() {
  for (const c of ["resource_transfers", "resource_reservations", "resource_locks", "audit_log", "rate_limits", "vehicles", "driver_profiles", "collection_routes"]) {
    const s = await db.collection(c).get(); if (!s.empty) { const b = db.batch(); s.docs.forEach((d) => b.delete(d.ref)); await b.commit(); }
  }
}
const proposal = (id, to, startMin, endMin) => db.doc(`resource_transfers/${id}`).set({ resourceType: "crew", resourceId: "VE1", driverId: "dE1", vehicleId: "VE1", fromMunicipalityId: "east", toMunicipalityId: to, status: "proposed",
  window: { startAt: iso(NOW + startMin * 60000), endAt: iso(NOW + endMin * 60000) }, createdAt: iso(NOW) });

await mkUser("amanah", { role: "executive" });
await mkUser("mgrE", { role: "manager", municipalityId: "east" });

await test("1. same driver, overlapping windows, concurrent approvals → exactly one approved", async () => {
  await wipe();
  await proposal("TA", "north", 0, 240); await proposal("TB", "south", 60, 300);
  const results = await Promise.allSettled([approveTransfer(db, { transferId: "TA", actor: { uid: "amanah", name: "a" } }), approveTransfer(db, { transferId: "TB", actor: { uid: "amanah", name: "a" } })]);
  const okCount = results.filter((r) => r.status === "fulfilled").length;
  const refused = results.filter((r) => r.status === "rejected" && r.reason?.httpStatus === 409).length;
  ok(okCount === 1 && refused === 1, `expected 1 approved + 1 refused, got ${okCount}/${refused}`);
  const st = await Promise.all(["TA", "TB"].map(async (id) => (await db.doc(`resource_transfers/${id}`).get()).get("status")));
  ok(st.filter((s) => s === "approved").length === 1 && st.filter((s) => s === "proposed").length === 1, `statuses ${st}`);
  const res = (await db.collection("resource_reservations").where("status", "==", "active").get()).docs.map((d) => d.data());
  ok(res.length === 2 && new Set(res.map((r) => r.transferId)).size === 1, "reservations not from one transfer");
});
await test("2. non-overlapping windows on the same driver → both approved", async () => {
  await wipe();
  await proposal("TC", "north", 0, 120); await proposal("TD", "south", 150, 300);
  ok((await call("amanah", { action: "approve", transferId: "TC" })).code === 200, "TC");
  ok((await call("amanah", { action: "approve", transferId: "TD" })).code === 200, "TD");
});
await test("3. approving twice is idempotent", async () => {
  const again = await call("amanah", { action: "approve", transferId: "TC" });
  ok(again.code === 200 && again.out.already === true, "not idempotent");
  ok((await db.collection("resource_reservations").where("transferId", "==", "TC").get()).size === 2, "duplicate reservations");
});
await test("4. a manager cannot approve; unknown transfer → 404", async () => {
  await proposal("TE", "north", 400, 500);
  ok((await call("mgrE", { action: "approve", transferId: "TE" })).code === 403, "manager allowed");
  ok((await call("amanah", { action: "approve", transferId: "NOPE" })).code === 404, "missing transfer");
});
await test("5. return releases the reservations; the resource can be approved again", async () => {
  await wipe();
  const b = db.batch();
  b.set(db.doc("vehicles/VE1"), { vehicleNumber: "VE1", municipalityId: "east", status: "available", driverId: "dE1" });
  b.set(db.doc("driver_profiles/dE1"), { uid: "dE1", municipalityId: "east", vehicleId: "VE1" });
  await b.commit();
  await proposal("TF", "north", 0, 240); await proposal("TG", "south", 30, 200);
  ok((await call("amanah", { action: "approve", transferId: "TF" })).code === 200, "TF approve");
  ok((await call("amanah", { action: "approve", transferId: "TG" })).code === 409, "TG should clash");
  ok((await call("amanah", { action: "execute", transferId: "TF" })).code === 200, "TF execute");
  ok((await call("amanah", { action: "return", transferId: "TF" })).code === 200, "TF return");
  ok((await db.collection("resource_reservations").where("transferId", "==", "TF").where("status", "==", "active").get()).empty, "reservation not released");
  ok((await call("amanah", { action: "approve", transferId: "TG" })).code === 200, "TG after release");
});

console.log(`\nTransfer reservations: ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
