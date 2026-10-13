/* global process */
// Shared server helpers: authentication (Firebase ID token + active profile), strict input validation,
// a Firestore-backed rate limiter (works across serverless instances), and server-side audit.
import { createHash } from "node:crypto";
import { adminAuth } from "./firebaseAdmin.mjs";

export const KNOWN_ROLES = ["citizen", "employee", "manager", "executive", "driver"];
export const SCOPED_ROLES = ["employee", "manager", "driver"];
export const ID_RE = /^[A-Za-z0-9_\-:.]{1,160}$/;
export const iso = (ms = Date.now()) => new Date(ms).toISOString();

export function readBody(req) {
  if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch { return null; } }
  return req.body && typeof req.body === "object" ? req.body : {};
}

/** Rejects unknown keys and wrong types. spec: { key: "string" | "number" | "object" | "array" | "id" | (v)=>bool } */
export function validateBody(body, spec, { required = [] } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "جسم الطلب غير صالح";
  for (const k of Object.keys(body)) if (!(k in spec)) return `حقل غير مسموح: ${k}`;
  for (const k of required) if (body[k] === undefined || body[k] === null || body[k] === "") return `حقل مطلوب: ${k}`;
  for (const [k, t] of Object.entries(spec)) {
    const v = body[k];
    if (v === undefined || v === null) continue;
    const ok = typeof t === "function" ? t(v) : t === "id" ? typeof v === "string" && ID_RE.test(v) : t === "array" ? Array.isArray(v) : typeof v === t;
    if (!ok) return `قيمة غير صالحة للحقل: ${k}`;
  }
  return null;
}

/** Verifies the Firebase ID token and loads the user's profile. Fail closed on anything unusual. */
export async function authenticate(req, db) {
  const header = String(req.headers?.authorization || "");
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return { error: [401, "Missing Authorization"] };
  let decoded;
  try { decoded = await adminAuth().verifyIdToken(token); } catch { return { error: [401, "Invalid token"] }; }
  const snap = await db.collection("users").doc(decoded.uid).get();
  if (!snap.exists) return { error: [403, "لا يوجد ملف مستخدم"] };
  const u = snap.data();
  if (u.status !== "active" || !KNOWN_ROLES.includes(u.role)) return { error: [403, "الحساب غير نشط أو بدور غير صالح"] };
  if (SCOPED_ROLES.includes(u.role) && !(typeof u.municipalityId === "string" && u.municipalityId)) return { error: [403, "حساب طاقم بلا بلدية"] };
  return { user: { uid: decoded.uid, role: u.role, municipalityId: u.municipalityId || null, name: u.fullName || decoded.email || "", district: u.district || "" } };
}

/** Per-route limits (count per window). Overridable for tests via RATE_LIMITS='{"route":{"limit":2,"windowSec":60}}'. */
export const DEFAULT_LIMITS = {
  "admin.users":     { limit: 30,  windowSec: 60 },
  "admin.transfers": { limit: 10,  windowSec: 60 },
  "field.confirm":   { limit: 60,  windowSec: 60 },
  "dispatch.manual": { limit: 6,   windowSec: 60 },
  "ops.adjustment":  { limit: 6,   windowSec: 60 },   // analyses are heavy (whole-municipality search)
  "ops.adjustment.decide": { limit: 20, windowSec: 60 },
  "ai.minute":       { limit: 20,  windowSec: 60 },
  "ai.day":          { limit: 200, windowSec: 86400 },
};
function limitFor(name) {
  let over = {};
  try { over = JSON.parse(process.env.RATE_LIMITS || "{}"); } catch { over = {}; }
  return { ...DEFAULT_LIMITS[name], ...(over[name] || {}) };
}

/**
 * Fixed-window counter stored in Firestore (rate_limits/{hash}), updated in a transaction so concurrent
 * serverless instances share one budget. Clients have no access to this collection (rules).
 * expiresAt is a Timestamp so a Firestore TTL policy on rate_limits.expiresAt can purge old windows.
 */
export async function rateLimit(db, name, subject, now = Date.now()) {
  const { limit, windowSec } = limitFor(name);
  const windowStart = Math.floor(now / (windowSec * 1000)) * windowSec * 1000;
  const id = createHash("sha256").update(`${name}|${subject}|${windowStart}`).digest("hex").slice(0, 40);
  const ref = db.collection("rate_limits").doc(id);
  return db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    const count = snap.exists ? snap.get("count") : 0;
    if (count >= limit) return { ok: false, retryAfterSec: Math.max(1, Math.ceil((windowStart + windowSec * 1000 - now) / 1000)), limit };
    t.set(ref, { name, count: count + 1, windowStart: iso(windowStart), expiresAt: new Date(windowStart + windowSec * 1000 * 2) }, { merge: true });
    return { ok: true, remaining: limit - count - 1, limit };
  });
}

/** Server-side audit entry (clients cannot forge source: "server"). */
export function serverAudit(db, actor, action, details = {}, municipalityId = null) {
  return db.collection("audit_log").add({ action, actorId: actor?.uid || "", actorName: actor?.name || "", municipalityId: municipalityId ?? actor?.municipalityId ?? null, details, source: "server", createdAt: iso() });
}

/** Common preamble: authenticate → rate limit (per user) → returns user or sends the error. */
export async function guard(req, res, db, limitName, { roles = null } = {}) {
  const who = await authenticate(req, db);
  if (who.error) { res.status(who.error[0]).json({ error: who.error[1] }); return null; }
  const rl = await rateLimit(db, limitName, who.user.uid);
  if (!rl.ok) { res.setHeader("Retry-After", String(rl.retryAfterSec)); res.status(429).json({ error: "تجاوزت حد الطلبات — حاول بعد قليل", retryAfterSec: rl.retryAfterSec }); return null; }
  if (roles && !roles.includes(who.user.role)) {
    await serverAudit(db, who.user, "access_denied", { route: limitName, role: who.user.role });
    res.status(403).json({ error: "غير مصرح لهذا الإجراء" });
    return null;
  }
  return who.user;
}
