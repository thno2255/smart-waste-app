// Vercel Serverless Function — minimum operational adjustment (operations / municipality / Amanah).
//   POST /api/ops/adjustment   Authorization: Bearer <Firebase ID token>
//   body: { action: "analyze", municipalityId? }                      → analysis stored in adjustment_analyses
//         { action: "approve", analysisId, alternativeId }           → re-verified and applied atomically (APPROVED)
//         { action: "reject",  analysisId, note? }
// The client sends ids only; every plan, cost and check is recomputed on the server.
import { adminDb } from "../_lib/firebaseAdmin.mjs";
import { guard, readBody, validateBody } from "../_lib/http.mjs";
import { analyzeAdjustment, approveAdjustment, rejectAdjustment, AdjustmentError } from "../_lib/adjustment.mjs";

const STAFF = ["executive", "manager", "employee"];

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  let db;
  try { db = adminDb(); } catch (e) { return res.status(500).json({ error: e.message }); }
  const body = readBody(req);
  const bad = validateBody(body, { action: (v) => ["analyze", "approve", "reject"].includes(v), municipalityId: "id", analysisId: "id", alternativeId: (v) => typeof v === "string" && v.length <= 600 && /^[A-Za-z0-9_\-:.+]+$/.test(v), note: (v) => typeof v === "string" && v.length <= 500 }, { required: ["action"] });
  if (bad) return res.status(400).json({ error: bad });
  const user = await guard(req, res, db, body.action === "analyze" ? "ops.adjustment" : "ops.adjustment.decide", { roles: STAFF });
  if (!user) return;
  try {
    if (body.action === "analyze") {
      const r = await analyzeAdjustment(db, { user, municipalityId: body.municipalityId || null });
      return res.status(200).json({ ok: true, id: r.id, status: r.status, analysisStatus: r.result.status });
    }
    if (!body.analysisId) return res.status(400).json({ error: "حقل مطلوب: analysisId" });
    if (body.action === "approve") {
      if (!body.alternativeId) return res.status(400).json({ error: "حقل مطلوب: alternativeId" });
      return res.status(200).json({ ok: true, ...(await approveAdjustment(db, { user, analysisId: body.analysisId, alternativeId: body.alternativeId })) });
    }
    return res.status(200).json({ ok: true, ...(await rejectAdjustment(db, { user, analysisId: body.analysisId, note: body.note || "" })) });
  } catch (e) {
    if (e instanceof AdjustmentError) return res.status(e.httpStatus).json({ error: e.message, code: e.reasonCode || null });
    console.error("[ops/adjustment]", e);
    return res.status(500).json({ error: "تعذر إكمال العملية — لم يتغير شيء في الخطة" });
  }
}
