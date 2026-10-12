// Vercel Serverless Function — trusted path for SENSITIVE user changes (role, status, municipality).
// Firestore rules deny these fields to every client (even the Amanah); this route writes them with firebase-admin
// after: Firebase ID token → active profile → per-user rate limit (Firestore-backed) → Amanah role → strict input.
// Idempotent: re-applying the current value writes nothing. Every change and every denied attempt is audited
// by the server. (Transfers re-home accounts through /api/admin/transfers, one transaction.)
//
//   POST /api/admin/users   Authorization: Bearer <Firebase ID token>
//   body: { action: "setRole" | "setStatus" | "setMunicipality", uid, role?, status?, municipalityId? }
import { adminDb } from "../_lib/firebaseAdmin.mjs";
import { guard, readBody, validateBody, serverAudit, iso } from "../_lib/http.mjs";
import municipalitiesData from "../../src/data/municipalities.json" with { type: "json" };

const MUNICIPALITY_IDS = new Set(municipalitiesData.municipalities.map((m) => m.id));
const ROLES = ["citizen", "employee", "manager", "executive", "driver"];
const SCOPED_ROLES = ["employee", "manager", "driver"];
const STATUSES = ["active", "pending", "rejected", "suspended"];
const ROLE_AR = { executive: "متخذ القرار بالأمانة", manager: "متخذ القرار بالبلدية", employee: "موظف العمليات", driver: "فرد ميداني (سائق)", citizen: "مواطن" };

export function validateUserChange({ action, actorUid, target, role, status, municipalityId }) {
  if (!target) return [404, "المستخدم غير موجود"];
  if ((action === "setRole" || action === "setStatus") && target.uid === actorUid) return [409, "لا يمكن تغيير دورك أو حالتك بنفسك"];
  if (action === "setRole") {
    if (!ROLES.includes(role)) return [400, "دور غير صالح"];
    if (SCOPED_ROLES.includes(role) && !MUNICIPALITY_IDS.has(target.municipalityId || "")) return [409, "حدّد بلدية صالحة للمستخدم قبل منحه هذا الدور"];
  }
  if (action === "setStatus") {
    if (!STATUSES.includes(status)) return [400, "حالة غير صالحة"];
    if (status === "active" && SCOPED_ROLES.includes(target.role) && !MUNICIPALITY_IDS.has(target.municipalityId || "")) return [409, "لا يُفعَّل حساب طاقم بلا بلدية صالحة"];
    if (status === "active" && !ROLES.includes(target.role)) return [409, "لا يُفعَّل حساب بدور غير صالح"];
  }
  if (action === "setMunicipality") {
    if (municipalityId != null && !MUNICIPALITY_IDS.has(municipalityId)) return [400, "بلدية غير معروفة"];
    if (municipalityId == null && SCOPED_ROLES.includes(target.role)) return [409, "حساب الطاقم يحتاج بلدية — غيّر الدور أولًا"];
    if (target.transferId) return [409, "الحساب في نقل مؤقت — أعد النقل أولًا"];
  }
  return null;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  let db;
  try { db = adminDb(); } catch (e) { return res.status(500).json({ error: e.message }); }
  const actor = await guard(req, res, db, "admin.users", { roles: ["executive"] });
  if (!actor) return;
  const body = readBody(req);
  const bad = validateBody(body, {
    action: (v) => ["setRole", "setStatus", "setMunicipality"].includes(v), uid: "id",
    role: "string", status: "string", municipalityId: (v) => typeof v === "string",
  }, { required: ["action", "uid"] });
  if (bad) return res.status(400).json({ error: bad });

  try {
    const uref = db.collection("users").doc(body.uid);
    const snap = await uref.get();
    const target = snap.exists ? { uid: body.uid, ...snap.data() } : null;
    const invalid = validateUserChange({ action: body.action, actorUid: actor.uid, target, role: body.role, status: body.status, municipalityId: body.municipalityId ?? null });
    if (invalid) {
      if (invalid[0] === 409 && target?.uid === actor.uid) await serverAudit(db, actor, "admin_self_change_blocked", { action: body.action, uid: body.uid });
      return res.status(invalid[0]).json({ error: invalid[1] });
    }
    if (body.action === "setRole") {
      if (target.role === body.role) return res.status(200).json({ ok: true, unchanged: true });
      await uref.update({ role: body.role, roleAr: ROLE_AR[body.role], updatedAt: iso() });
      await serverAudit(db, actor, "user_role_changed", { uid: body.uid, from: target.role || null, to: body.role }, target.municipalityId || null);
    } else if (body.action === "setStatus") {
      if (target.status === body.status) return res.status(200).json({ ok: true, unchanged: true });
      await uref.update({ status: body.status, updatedAt: iso() });
      await serverAudit(db, actor, "user_status_changed", { uid: body.uid, from: target.status || null, to: body.status }, target.municipalityId || null);
    } else {
      const mid = body.municipalityId ?? null;
      if ((target.municipalityId || null) === mid) return res.status(200).json({ ok: true, unchanged: true });
      const batch = db.batch();
      batch.update(uref, { municipalityId: mid, updatedAt: iso() });
      const prof = await db.collection("driver_profiles").doc(body.uid).get();
      if (prof.exists) batch.update(prof.ref, { municipalityId: mid, updatedAt: iso() });
      await batch.commit();
      await serverAudit(db, actor, "user_municipality_set", { uid: body.uid, from: target.municipalityId || null, to: mid }, mid);
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("[admin/users]", e);
    return res.status(500).json({ error: "تعذر تنفيذ التغيير" });
  }
}
