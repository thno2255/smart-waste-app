/* global process, Buffer */
// Vercel Serverless Function — Autonomous Dispatch cycle
//   GET  /api/dispatch/run            ← Vercel Cron (Authorization: Bearer $CRON_SECRET), periodic: respects periodMinutes
//   POST /api/dispatch/run            ← signed-in staff (Authorization: Bearer <Firebase ID token>)
//        body: { municipalityId?, trigger?: "manual" | "simulator_event" }
// Who may trigger a cycle:
//   - the Amanah decision maker (role executive): any municipality or all;
//   - a municipality manager / operations employee: their OWN municipality only (urgent / demo events).
// What the cycle may do is governed by dispatch_settings/config (mode off | observe | auto, scope),
// which only the Amanah can change (firestore.rules). Kill switch: DISPATCH_API_ENABLED=false.
import { timingSafeEqual } from "node:crypto";
import { adminDb } from "../_lib/firebaseAdmin.mjs";
import { authenticate, rateLimit } from "../_lib/http.mjs";
import { runDispatchCycle } from "../_lib/dispatchRunner.mjs";

const STAFF = ["executive", "manager", "employee"];

async function identify(req, db) {
  const header = String(req.headers.authorization || "");
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return { error: [401, "Missing Authorization"] };
  if (process.env.CRON_SECRET && token.length === process.env.CRON_SECRET.length && timingSafeEqual(Buffer.from(token), Buffer.from(process.env.CRON_SECRET))) return { cron: true };
  const who = await authenticate(req, db); // active profile + known role + municipality for scoped roles (fail closed)
  if (who.error) return who;
  if (!STAFF.includes(who.user.role)) return { error: [403, "Not allowed"] };
  const rl = await rateLimit(db, "dispatch.manual", who.user.uid);
  if (!rl.ok) return { error: [429, "تجاوزت حد تشغيل الدورات اليدوية — حاول بعد قليل"], retryAfterSec: rl.retryAfterSec };
  return { user: who.user };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (process.env.DISPATCH_API_ENABLED === "false") return res.status(503).json({ error: "Dispatch API disabled" });
  if (!["GET", "POST"].includes(req.method)) return res.status(405).json({ error: "Method not allowed" });
  let db;
  try { db = adminDb(); } catch (e) { return res.status(500).json({ error: e.message }); }
  const who = await identify(req, db);
  if (who.error) { if (who.retryAfterSec) res.setHeader("Retry-After", String(who.retryAfterSec)); return res.status(who.error[0]).json({ error: who.error[1] }); }

  if (who.cron) {
    const r = await runDispatchCycle(db, { trigger: "cron" });
    return res.status(200).json(r);
  }
  const body = typeof req.body === "string" ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body || {});
  const u = who.user;
  const trigger = ["manual", "simulator_event"].includes(body.trigger) ? body.trigger : "manual";
  let municipalityId = body.municipalityId || null;
  if (u.role !== "executive") {
    if (!u.municipalityId) return res.status(403).json({ error: "No municipality on this account" });
    if (municipalityId && municipalityId !== u.municipalityId) return res.status(403).json({ error: "Outside your municipality" });
    municipalityId = u.municipalityId;
  }
  try {
    const r = await runDispatchCycle(db, { trigger, municipalityId, actor: u });
    return res.status(200).json(r);
  } catch (e) {
    console.error("[dispatch/run]", e);
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
