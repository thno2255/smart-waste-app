/* global process */
/**
 * Backfill `municipalityId` on documents the fail-closed rules scope by municipality
 * (docs/security/SECURITY_FIX_PLAN.md §2). Read-mostly and idempotent: a document that already has a
 * municipalityId is never touched. DRY RUN by default; pass --apply to write.
 *
 *   Emulator:   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/migrations/backfill-security-scope.mjs [--apply]
 *   Production: FIREBASE_SERVICE_ACCOUNT_JSON='…' node scripts/migrations/backfill-security-scope.mjs [--apply]   (owner's approval only)
 */
import { adminDb } from "../../api/_lib/firebaseAdmin.mjs";
import { normalizeNeighborhoodName } from "../../src/config.js";
import mapData from "../../src/data/neighborhoodMunicipalityMap.json" with { type: "json" };

export async function backfillSecurityScope(db, { apply = false } = {}) {
  const docs = async (c) => (await db.collection(c).get()).docs;
  const binMun = new Map((await docs("bins")).map((d) => [d.id, d.get("municipalityId") || null]));
  const nbMun = new Map((await docs("neighborhoods")).map((d) => [d.id, d.get("municipalityId") || mapData.assignments[normalizeNeighborhoodName(d.get("name") || "")]?.municipalityId || null]));
  const routeMun = new Map((await docs("collection_routes")).map((d) => [d.id, d.get("municipalityId") || null]));
  const vehMun = new Map((await docs("vehicles")).map((d) => [d.id, d.get("municipalityId") || null]));
  const byDistrict = (name) => mapData.assignments[normalizeNeighborhoodName(name || "")]?.municipalityId || null;
  const plan = {
    requests:               (d) => byDistrict(d.get("district")),
    citizen_reports:        (d) => (d.get("binId") && binMun.get(d.get("binId"))) || byDistrict(d.get("district")),
    alerts:                 (d) => binMun.get(d.get("sourceId")) || nbMun.get(d.get("sourceId")) || null,
    iot_devices:            (d) => binMun.get(d.get("binId")) || null,
    collection_events:      (d) => routeMun.get(d.get("routeId")) || binMun.get(d.get("binId")) || null,
    vehicle_status_history: (d) => vehMun.get(d.get("vehicleId")) || null,
  };
  const report = {};
  for (const [col, resolve] of Object.entries(plan)) {
    const r = { scanned: 0, alreadyScoped: 0, resolved: 0, unresolved: 0, written: 0 };
    let batch = db.batch(), n = 0;
    for (const d of await docs(col)) {
      r.scanned += 1;
      if (d.get("municipalityId")) { r.alreadyScoped += 1; continue; }
      const mid = resolve(d);
      if (!mid) { r.unresolved += 1; continue; }
      r.resolved += 1;
      if (apply) { batch.update(d.ref, { municipalityId: mid, municipalityBackfilledAt: new Date().toISOString() }); n += 1; r.written += 1; if (n === 400) { await batch.commit(); batch = db.batch(); n = 0; } }
    }
    if (apply && n) await batch.commit();
    report[col] = r;
  }
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const apply = process.argv.includes("--apply");
  const report = await backfillSecurityScope(adminDb(), { apply });
  console.log(apply ? "APPLIED" : "DRY RUN (pass --apply to write)");
  console.table(report);
  process.exit(0);
}
