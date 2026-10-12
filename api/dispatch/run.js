/* global process */
// Vercel Serverless Function — Autonomous Dispatch cycle
//   GET  /api/dispatch/run            ← Vercel Cron (Authorization: Bearer $CRON_SECRET), periodic: respects periodMinutes
//   POST /api/dispatch/run            ← signed-in staff (Authorization: Bearer <Firebase ID token>)
//        body: { municipalityId?, trigger?: "manual" | "simulator_event" }
// Who may trigger a cycle:
//   - the Amanah decision maker (role executive): any municipality or all;
//   - a municipality manager / operations employee: their OWN municipality only (urgent / demo events).
// What the cycle may do is governed by dispatch_settings/config (mode off | observe | auto, scope),
// which only the Amanah can change (firestore.rules). Kill switch: DISPATCH_API_ENABLED=false.
import { adminDb, adminAuth } from "../_lib/firebaseAdmin.mjs";
import { runDispatchCycle } from "../_lib/dispatchRunner.mjs";

const STAFF = ["executive", "manager", "employee"];

async function identify(req, db) {
  const header = String(req.headers.authorization || "");
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return { error: [401, "Missing Authorization"] };
  if (process.env.CRON_SECRET && token === process.env.CRON_SECRET) return { cron: true };
  try {
    const decoded = await adminAuth().verifyIdToken(token);
    const u = await db.collection("users").doc(decoded.uid).get();
    const role = u.exists ? u.get("role") : null;
    const status = u.exists ? u.get("status") : null;
    if (!STAFF.includes(role) || !["active", "approved"].includes(status)) return { error: [403, "Not allowed"] };
    return { user: { uid: decoded.uid, name: u.get("fullName") || u.get("name") || decoded.email || "", role, municipalityId: u.get("municipalityId") || null } };
  } catch { return { error: [401, "Invalid token"] }; }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (process.env.DISPATCH_API_ENABLED === "false") return res.status(503).json({ error: "Dispatch API disabled" });
  if (!["GET", "POST"].includes(req.method)) return res.status(405).json({ error: "Method not allowed" });
  let db;
  try { db = adminDb(); } catch (e) { return res.status(500).json({ error: e.message }); }
  const who = await identify(req, db);
  if (who.error) return res.status(who.error[0]).json({ error: who.error[1] });

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
