// Vercel Serverless Function — a driver confirms the emptying of ONE stop of THEIR in-progress route.
//   POST /api/field/confirm-collection   Authorization: Bearer <Firebase ID token>
//   body: { routeId, binId, clientConfirmedAt?, position?: { lat, lng, accuracy } }
import { adminDb } from "../_lib/firebaseAdmin.mjs";
import { guard, readBody, validateBody } from "../_lib/http.mjs";
import { confirmCollectionServer, ConfirmError } from "../_lib/collection.mjs";

const isPos = (p) => p && typeof p === "object" && !Array.isArray(p) && Object.keys(p).every((k) => ["lat", "lng", "accuracy"].includes(k)) && Object.values(p).every((v) => v == null || Number.isFinite(v));

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  let db;
  try { db = adminDb(); } catch (e) { return res.status(500).json({ error: e.message }); }
  const user = await guard(req, res, db, "field.confirm", { roles: ["driver"] });
  if (!user) return;
  const body = readBody(req);
  const bad = validateBody(body, { routeId: "id", binId: "id", clientConfirmedAt: "string", position: isPos }, { required: ["routeId", "binId"] });
  if (bad) return res.status(400).json({ error: bad });
  try {
    const r = await confirmCollectionServer(db, { driver: user, routeId: body.routeId, binId: body.binId, clientConfirmedAt: body.clientConfirmedAt, position: body.position });
    return res.status(200).json({ ok: true, ...r });
  } catch (e) {
    if (e instanceof ConfirmError) return res.status(e.httpStatus).json({ error: e.message });
    console.error("[confirm-collection]", e);
    return res.status(500).json({ error: "تعذر تسجيل التفريغ" });
  }
}
