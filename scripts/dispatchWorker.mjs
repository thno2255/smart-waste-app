/* global process */
/**
 * Local / self-hosted dispatch worker — a SERVER process (not a browser timer) that runs the
 * autonomous dispatch cycle every `periodMinutes` from dispatch_settings/config.
 *
 *   Emulator:   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/dispatchWorker.mjs
 *   One cycle:  FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/dispatchWorker.mjs --once [--municipality east] [--force]
 *   Production: FIREBASE_SERVICE_ACCOUNT_JSON='…' node scripts/dispatchWorker.mjs   (only with explicit approval)
 */
import { adminDb } from "../api/_lib/firebaseAdmin.mjs";
import { runDispatchCycle, readDispatchSettings } from "../api/_lib/dispatchRunner.mjs";

const args = process.argv.slice(2);
const once = args.includes("--once");
const force = args.includes("--force");
const mIdx = args.indexOf("--municipality");
const municipalityId = mIdx >= 0 ? args[mIdx + 1] : null;
const db = adminDb();

async function tick() {
  const r = await runDispatchCycle(db, { trigger: once && municipalityId ? "manual" : "heartbeat", municipalityId, force });
  const line = r.skipped ? `skipped (${r.skipped}${r.nextDueAt ? ` → ${r.nextDueAt}` : ""})` : Object.entries(r.municipalities).map(([m, t]) => `${m}: +${t.created} جولة · ${t.inserted} إدراج · ${t.reassigned} إعادة إسناد · ${t.escalated} تصعيد · ${t.executed} منفذ · ${t.observed} مراقبة · ${t.rejected} مرفوض`).join(" | ");
  console.log(new Date().toISOString(), r.mode || "", line);
}
if (once) { await tick(); process.exit(0); }
for (;;) {
  try { await tick(); } catch (e) { console.error(e); }
  const s = await readDispatchSettings(db).catch(() => ({ periodMinutes: 15 }));
  await new Promise((r) => setTimeout(r, Math.max(1, s.periodMinutes) * 60000));
}
