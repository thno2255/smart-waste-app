/* global process */
/**
 * Backfill `municipalityId` on documents the fail-closed rules scope by municipality
 * (docs/security/SECURITY_FIX_PLAN.md §2) — plus a READ-ONLY review of user accounts.
 *
 * Safety properties (docs/security/MIGRATION_READINESS.md):
 *   • DRY RUN by default — prints and saves the expected changes; writes nothing.
 *   • --apply REQUIRES --backup <dir>: before any write, every document that will change is saved
 *     (id + the fields it had) to <dir>/backup-<ts>.json. No backup → no apply.
 *   • Idempotent: documents that already have a municipalityId are never touched; re-runs write 0.
 *   • Additive only: adds municipalityId + municipalityBackfilledAt; never deletes or overwrites other fields.
 *   • Verification: document counts per collection before/after must be identical; scoped count must grow by the
 *     number written; any mismatch exits non-zero.
 *   • --restore <backup.json>: removes ONLY the fields this migration added, and only where the document still
 *     carries this migration's marker and value (later edits are left alone).
 *   • User accounts (status "approved", staff without municipality) are REPORTED, never changed.
 *
 *   Emulator:   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/migrations/backfill-security-scope.mjs [--report out.json]
 *               ... --apply --backup ./migration-backups
 *               ... --restore ./migration-backups/backup-<ts>.json
 *   Production: FIREBASE_SERVICE_ACCOUNT_JSON='…' (owner's approval only; never from CI)
 */
import { FieldValue } from "firebase-admin/firestore";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { adminDb } from "../../api/_lib/firebaseAdmin.mjs";
import { normalizeNeighborhoodName } from "../../src/config.js";
import mapData from "../../src/data/neighborhoodMunicipalityMap.json" with { type: "json" };

const MARKER = "municipalityBackfilledAt";
const SCOPED_ROLES = ["employee", "manager", "driver"];

async function resolvers(db) {
  const docs = async (c) => (await db.collection(c).get()).docs;
  const binMun = new Map((await docs("bins")).map((d) => [d.id, d.get("municipalityId") || null]));
  const nbMun = new Map((await docs("neighborhoods")).map((d) => [d.id, d.get("municipalityId") || mapData.assignments[normalizeNeighborhoodName(d.get("name") || "")]?.municipalityId || null]));
  const routeMun = new Map((await docs("collection_routes")).map((d) => [d.id, d.get("municipalityId") || null]));
  const vehMun = new Map((await docs("vehicles")).map((d) => [d.id, d.get("municipalityId") || null]));
  const byDistrict = (name) => mapData.assignments[normalizeNeighborhoodName(name || "")]?.municipalityId || null;
  return {
    requests:               (d) => byDistrict(d.get("district")),
    citizen_reports:        (d) => (d.get("binId") && binMun.get(d.get("binId"))) || byDistrict(d.get("district")),
    alerts:                 (d) => binMun.get(d.get("sourceId")) || nbMun.get(d.get("sourceId")) || null,
    iot_devices:            (d) => binMun.get(d.get("binId")) || null,
    collection_events:      (d) => routeMun.get(d.get("routeId")) || binMun.get(d.get("binId")) || null,
    vehicle_status_history: (d) => vehMun.get(d.get("vehicleId")) || null,
  };
}

/** Read-only review of accounts the fail-closed rules will lock out. Never modifies users. */
export async function reviewUsers(db) {
  const users = (await db.collection("users").get()).docs.map((d) => ({ uid: d.id, ...d.data() }));
  const pick = (u) => ({ uid: u.uid, email: u.email || "", role: u.role || null, status: u.status || null, municipalityId: u.municipalityId || null });
  return {
    total: users.length,
    statusApproved: users.filter((u) => u.status === "approved").map(pick),
    staffWithoutMunicipality: users.filter((u) => SCOPED_ROLES.includes(u.role) && !u.municipalityId).map(pick),
    unknownRole: users.filter((u) => u.role && !["citizen", ...SCOPED_ROLES, "executive"].includes(u.role)).map(pick),
    policy: "تقرير فقط — لا يغيّر الترحيل أي حساب. يُعالَج كل حساب يدويًا عبر /api/admin/users وفق docs/security/MIGRATION_READINESS.md §5",
  };
}

export async function backfillSecurityScope(db, { apply = false, backupDir = null, now = new Date().toISOString() } = {}) {
  if (apply && !backupDir) throw new Error("--apply يتطلب --backup <dir>: لا تطبيق بلا نسخة احتياطية");
  const plan = await resolvers(db);
  const report = {}, changes = [];
  for (const [col, resolve] of Object.entries(plan)) {
    const snap = await db.collection(col).get();
    const r = { countBefore: snap.size, alreadyScoped: 0, toWrite: 0, unresolved: 0, written: 0, sampleIds: [], unresolvedIds: [] };
    for (const d of snap.docs) {
      if (d.get("municipalityId")) { r.alreadyScoped += 1; continue; }
      const mid = resolve(d);
      if (!mid) { r.unresolved += 1; if (r.unresolvedIds.length < 20) r.unresolvedIds.push(d.id); continue; }
      r.toWrite += 1; if (r.sampleIds.length < 10) r.sampleIds.push(d.id);
      changes.push({ col, id: d.id, mid, before: { municipalityId: d.get("municipalityId") ?? null, [MARKER]: d.get(MARKER) ?? null } });
    }
    report[col] = r;
  }
  let backupFile = null;
  if (apply && changes.length) {
    mkdirSync(backupDir, { recursive: true });
    backupFile = join(backupDir, `backup-${now.replace(/[:.]/g, "-")}.json`);
    writeFileSync(backupFile, JSON.stringify({ migration: "backfill-security-scope", createdAt: now, marker: MARKER, changes }, null, 2));
    let batch = db.batch(), n = 0;
    for (const c of changes) {
      batch.update(db.collection(c.col).doc(c.id), { municipalityId: c.mid, [MARKER]: now });
      report[c.col].written += 1;
      if (++n === 400) { await batch.commit(); batch = db.batch(); n = 0; }
    }
    if (n) await batch.commit();
  }
  // Verification: counts unchanged, scoped count grew by exactly what was written.
  const verification = {};
  let ok = true;
  for (const col of Object.keys(plan)) {
    const after = await db.collection(col).get();
    const scopedAfter = after.docs.filter((d) => d.get("municipalityId")).length;
    const expectScoped = report[col].alreadyScoped + report[col].written;
    const v = { countAfter: after.size, countUnchanged: after.size === report[col].countBefore, scopedAfter, scopedAsExpected: scopedAfter === expectScoped };
    if (!v.countUnchanged || !v.scopedAsExpected) ok = false;
    verification[col] = v;
  }
  return { mode: apply ? "apply" : "dry-run", report, verification, ok, backupFile, users: await reviewUsers(db) };
}

/** Undo: remove only what this migration added (marker + municipalityId) where both still match the backup. */
export async function restoreBackup(db, backupFile) {
  const data = JSON.parse(readFileSync(backupFile, "utf8"));
  const res = { restored: 0, skippedChanged: 0 };
  let batch = db.batch(), n = 0;
  for (const c of data.changes) {
    const ref = db.collection(c.col).doc(c.id);
    const snap = await ref.get();
    if (!snap.exists || snap.get(MARKER) !== data.createdAt || snap.get("municipalityId") !== c.mid) { res.skippedChanged += 1; continue; }
    batch.update(ref, { municipalityId: c.before.municipalityId ?? FieldValue.delete(), [MARKER]: FieldValue.delete() });
    res.restored += 1;
    if (++n === 400) { await batch.commit(); batch = db.batch(); n = 0; }
  }
  if (n) await batch.commit();
  return res;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; };
  const db = adminDb();
  if (arg("--restore")) { console.log("RESTORE", await restoreBackup(db, arg("--restore"))); process.exit(0); }
  const out = await backfillSecurityScope(db, { apply: process.argv.includes("--apply"), backupDir: arg("--backup") });
  console.log(out.mode === "apply" ? `APPLIED — backup: ${out.backupFile || "(لا تغييرات)"}` : "DRY RUN — لم يُكتب شيء (للتطبيق: --apply --backup <dir>)");
  console.table(Object.fromEntries(Object.entries(out.report).map(([k, v]) => [k, { before: v.countBefore, scoped: v.alreadyScoped, toWrite: v.toWrite, unresolved: v.unresolved, written: v.written }])));
  console.log("verification ok:", out.ok);
  console.log(`users: ${out.users.total} · approved: ${out.users.statusApproved.length} · staff without municipality: ${out.users.staffWithoutMunicipality.length} · unknown role: ${out.users.unknownRole.length}`);
  if (arg("--report")) writeFileSync(arg("--report"), JSON.stringify(out, null, 2));
  process.exit(out.ok ? 0 : 2);
}
