// Vercel Serverless Function — execute / return an APPROVED inter-municipality transfer (Amanah only).
//   POST /api/admin/transfers   Authorization: Bearer <Firebase ID token>   body: { action: "execute" | "return", transferId }
import { adminDb } from "../_lib/firebaseAdmin.mjs";
import { guard, readBody, validateBody } from "../_lib/http.mjs";
import { runTransfer, TransferError } from "../_lib/transfers.mjs";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  let db;
  try { db = adminDb(); } catch (e) { return res.status(500).json({ error: e.message }); }
  const user = await guard(req, res, db, "admin.transfers", { roles: ["executive"] });
  if (!user) return;
  const body = readBody(req);
  const bad = validateBody(body, { action: (v) => v === "execute" || v === "return", transferId: "id" }, { required: ["action", "transferId"] });
  if (bad) return res.status(400).json({ error: bad });
  try {
    const r = await runTransfer(db, { action: body.action, transferId: body.transferId, actor: user });
    return res.status(200).json({ ok: true, ...r });
  } catch (e) {
    if (e instanceof TransferError) return res.status(e.httpStatus).json({ error: e.message });
    console.error("[admin/transfers]", e);
    return res.status(500).json({ error: "تعذر تنفيذ النقل — لم يتغير أي مورد" });
  }
}
