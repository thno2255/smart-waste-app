// Vercel Serverless Function — trusted path for SENSITIVE user changes (role, status, municipality, transfer re-homing).
// Firestore rules deny these fields to every client (even the Amanah); this route writes them with firebase-admin
// after verifying the caller's Firebase ID token AND that the caller is an ACTIVE Amanah decision maker (executive).
//
//   POST /api/admin/users   Authorization: Bearer <Firebase ID token>
//   body: { action: "setRole" | "setStatus" | "setMunicipality" | "applyTransfer" | "revertTransfer", uid?, role?, status?, municipalityId?, transferId? }
//
// Every change writes a server-side audit entry (source: "server") that clients cannot forge.
import { adminDb, adminAuth } from "../_lib/firebaseAdmin.mjs";
import municipalitiesData from "../../src/data/municipalities.json" with { type: "json" };

const MUNICIPALITY_IDS = new Set(municipalitiesData.municipalities.map((m) => m.id));
const ROLES = ["citizen", "employee", "manager", "executive", "driver"];
const SCOPED_ROLES = ["employee", "manager", "driver"];
const STATUSES = ["active", "pending", "rejected", "suspended"];
const ROLE_AR = { executive: "متخذ القرار بالأمانة", manager: "متخذ القرار بالبلدية", employee: "موظف العمليات", driver: "فرد ميداني (سائق)", citizen: "مواطن" };
const iso = () => new Date().toISOString();

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
  }
  return null;
}

async function identify(req, db) {
  const header = String(req.headers.authorization || "");
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return { error: [401, "Missing Authorization"] };
  try {
    const decoded = await adminAuth().verifyIdToken(token);
    const u = await db.collection("users").doc(decoded.uid).get();
    if (!u.exists || u.get("role") !== "executive" || u.get("status") !== "active") return { error: [403, "هذا الإجراء لمتخذ القرار بالأمانة فقط"] };
    return { actor: { uid: decoded.uid, name: u.get("fullName") || decoded.email || "" } };
  } catch { return { error: [401, "Invalid token"] }; }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  let db;
  try { db = adminDb(); } catch (e) { return res.status(500).json({ error: e.message }); }
  const who = await identify(req, db);
  if (who.error) return res.status(who.error[0]).json({ error: who.error[1] });
  const body = typeof req.body === "string" ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body || {});
  const { action } = body;
  const audit = (entry) => db.collection("audit_log").add({ ...entry, actorId: who.actor.uid, actorName: who.actor.name, source: "server", createdAt: iso() });

  try {
    if (action === "applyTransfer" || action === "revertTransfer") {
      const t = await db.collection("resource_transfers").doc(String(body.transferId || "")).get();
      if (!t.exists) return res.status(404).json({ error: "النقل غير موجود" });
      const tr = t.data();
      const uid = tr.resourceType === "driver" ? tr.resourceId : tr.driverId;
      if (!uid || tr.resourceType === "vehicle") return res.status(200).json({ ok: true, skipped: "no driver in this transfer" });
      if (action === "applyTransfer" && tr.status !== "executed") return res.status(409).json({ error: "النقل غير منفَّذ" });
      if (action === "revertTransfer" && tr.status !== "returned") return res.status(409).json({ error: "النقل لم يُعَد" });
      const uref = db.collection("users").doc(uid);
      const u = await uref.get();
      if (!u.exists) return res.status(200).json({ ok: true, skipped: "no user doc" });
      const patch = action === "applyTransfer"
        ? { municipalityId: tr.toMunicipalityId, homeMunicipalityId: u.get("homeMunicipalityId") || u.get("municipalityId") || tr.fromMunicipalityId, transferId: t.id, transferUntil: tr.until || null, updatedAt: iso() }
        : { municipalityId: u.get("homeMunicipalityId") || tr.fromMunicipalityId, transferId: null, transferUntil: null, updatedAt: iso() };
      await uref.update(patch);
      await audit({ action: action === "applyTransfer" ? "user_transfer_applied" : "user_transfer_reverted", municipalityId: patch.municipalityId, details: { uid, transferId: t.id, from: tr.fromMunicipalityId, to: tr.toMunicipalityId } });
      return res.status(200).json({ ok: true, uid, municipalityId: patch.municipalityId });
    }

    const uid = String(body.uid || "");
    const uref = db.collection("users").doc(uid);
    const snap = uid ? await uref.get() : null;
    const target = snap?.exists ? { uid, ...snap.data() } : null;
    const bad = validateUserChange({ action, actorUid: who.actor.uid, target, role: body.role, status: body.status, municipalityId: body.municipalityId ?? null });
    if (bad) return res.status(bad[0]).json({ error: bad[1] });

    if (action === "setRole") {
      await uref.update({ role: body.role, roleAr: ROLE_AR[body.role], updatedAt: iso() });
      await audit({ action: "user_role_changed", municipalityId: target.municipalityId || null, details: { uid, from: target.role || null, to: body.role } });
    } else if (action === "setStatus") {
      await uref.update({ status: body.status, updatedAt: iso() });
      await audit({ action: "user_status_changed", municipalityId: target.municipalityId || null, details: { uid, from: target.status || null, to: body.status } });
    } else if (action === "setMunicipality") {
      const mid = body.municipalityId ?? null;
      const batch = db.batch();
      batch.update(uref, { municipalityId: mid, updatedAt: iso() });
      const prof = await db.collection("driver_profiles").doc(uid).get();
      if (prof.exists) batch.update(prof.ref, { municipalityId: mid, updatedAt: iso() });
      await batch.commit();
      await audit({ action: "user_municipality_set", municipalityId: mid, details: { uid, from: target.municipalityId || null, to: mid } });
    } else return res.status(400).json({ error: "إجراء غير معروف" });
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("[admin/users]", e);
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
