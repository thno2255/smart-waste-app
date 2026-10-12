/* global process */
// Vercel Serverless Function — AI assistant (read-only, scoped).
//   GET  /api/ai          → { enabled }                 (authenticated)
//   POST /api/ai          → { reply }   body: { question, history?: [{ role: "user"|"assistant", content }] }
// Security model: Firebase ID token + active profile; per-user minute AND daily limits (Firestore-backed);
// the context is built on the SERVER from data the caller may see (buildAiContext); the client cannot send
// system prompts, models, tools or scope; the model gets NO tools, so it cannot act on the user's behalf.
// The provider key lives in GROQ_API_KEY on the server only (never in the browser).
import { adminDb } from "./_lib/firebaseAdmin.mjs";
import { authenticate, rateLimit, readBody, validateBody } from "./_lib/http.mjs";
import { buildAiContext, SYSTEM_RULES } from "./_lib/aiContext.mjs";

const MODEL = "llama-3.3-70b-versatile";
const isHistory = (h) => Array.isArray(h) && h.length <= 6 && h.every((m) => m && typeof m === "object" && Object.keys(m).every((k) => k === "role" || k === "content") && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.length <= 1000);

export async function groqLLM({ messages }) {
  const key = process.env.GROQ_API_KEY;
  if (!key) { const e = new Error("المساعد غير مفعّل على الخادم"); e.code = 503; throw e; }
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify({ model: MODEL, max_tokens: 600, temperature: 0.2, messages }) });
  if (!r.ok) { const e = new Error(`LLM ${r.status}`); e.code = r.status === 429 ? 429 : 502; throw e; }
  const data = await r.json();
  return data?.choices?.[0]?.message?.content || "";
}

export function createAiHandler({ llm = groqLLM } = {}) {
  return async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    let db;
    try { db = adminDb(); } catch (e) { return res.status(500).json({ error: e.message }); }
    const who = await authenticate(req, db);
    if (who.error) return res.status(who.error[0]).json({ error: who.error[1] });
    if (req.method === "GET") return res.status(200).json({ enabled: llm !== groqLLM || !!process.env.GROQ_API_KEY });
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    for (const [name] of [["ai.minute"], ["ai.day"]]) {
      const rl = await rateLimit(db, name, who.user.uid);
      if (!rl.ok) { res.setHeader("Retry-After", String(rl.retryAfterSec)); return res.status(429).json({ error: "تجاوزت حد استخدام المساعد — حاول لاحقًا" }); }
    }
    const body = readBody(req);
    const bad = validateBody(body, { question: (v) => typeof v === "string" && v.trim().length > 0 && v.length <= 500, history: isHistory }, { required: ["question"] });
    if (bad) return res.status(400).json({ error: bad });
    try {
      const context = await buildAiContext(db, who.user);
      const messages = [{ role: "system", content: `${SYSTEM_RULES}\n\nالبيانات المتاحة لك:\n${context}` }, ...(body.history || []), { role: "user", content: body.question.trim() }];
      const reply = await llm({ messages, user: who.user });
      return res.status(200).json({ reply: String(reply || "لم أتمكن من الإجابة.").slice(0, 4000) });
    } catch (e) {
      return res.status(e.code && e.code >= 400 && e.code < 600 ? e.code : 500).json({ error: e.code === 503 ? e.message : "تعذر الحصول على إجابة" });
    }
  };
}
export default createAiHandler();
