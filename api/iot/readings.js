/* global process, Buffer */
// Vercel Serverless Function — ESP32 / IoT reading ingest
// POST /api/iot/readings
//   headers: x-device-key: <per-device secret>
//   body:    { device_id, fill_level_percent, temperature_celsius, battery_level?, signal?, timestamp? }
//
// Security model (the reason this is server-side and not a client write):
//   - The device proves itself with a per-device key stored on its iot_devices
//     doc; the key is never a Firebase Auth session and never grants anything
//     beyond writing readings for ITS OWN bin.
//   - The bin id is resolved from the device doc on the server — a client-
//     asserted bin id is never trusted.
//   - Out-of-range values are rejected (never stored) — the same bounds the
//     dashboard uses (src/config.js THRESHOLDS.faultReadingBounds).
//   - Writes use firebase-admin (service account), which bypasses client
//     rules; the client rules in /firestore.rules deny direct client writes to
//     sensor_readings so this route is the ONLY ingest path.
//
// Required env (Vercel → Project → Settings → Environment Variables, NOT VITE_-prefixed):
//   FIREBASE_SERVICE_ACCOUNT_JSON  — the full service-account JSON, as one line
//   IOT_INGEST_ENABLED             — "true" to accept readings (kill switch)
import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { createHash, timingSafeEqual } from "node:crypto";

const BOUNDS = { fillMin: 0, fillMax: 100, tempMin: -10, tempMax: 120 }; // mirrors src/config.js THRESHOLDS.faultReadingBounds
const MIN_SECONDS_BETWEEN_READINGS = 5; // per device — light abuse guard, not a production rate limiter
const DEMO_KEY = "demo-key-not-for-production";

function admin() {
  if (!getApps().length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not set");
    initializeApp({ credential: cert(JSON.parse(raw)) });
  }
  return getFirestore();
}

const sha256 = (s) => createHash("sha256").update(String(s)).digest("hex");
function keysMatch(presented, storedHash) {
  const a = Buffer.from(sha256(presented));
  const b = Buffer.from(String(storedHash || ""));
  return a.length === b.length && timingSafeEqual(a, b);
}

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (process.env.IOT_INGEST_ENABLED !== "true") return res.status(503).json({ error: "IoT ingest is disabled" });

  const deviceKey = req.headers["x-device-key"];
  if (!deviceKey || typeof deviceKey !== "string") return res.status(401).json({ error: "Missing x-device-key" });
  if (deviceKey === DEMO_KEY) return res.status(401).json({ error: "Demo key is not accepted by the live ingest" });

  const body = typeof req.body === "string" ? safeJson(req.body) : (req.body || {});
  const deviceId = String(body.device_id || "").trim();
  if (!deviceId) return res.status(400).json({ error: "device_id is required" });

  const fill = num(body.fill_level_percent);
  const temp = num(body.temperature_celsius);
  if (fill == null && temp == null) return res.status(400).json({ error: "fill_level_percent or temperature_celsius is required" });
  if (fill != null && (fill < BOUNDS.fillMin || fill > BOUNDS.fillMax)) return res.status(422).json({ error: `fill_level_percent out of range [${BOUNDS.fillMin},${BOUNDS.fillMax}]` });
  if (temp != null && (temp < BOUNDS.tempMin || temp > BOUNDS.tempMax)) return res.status(422).json({ error: `temperature_celsius out of range [${BOUNDS.tempMin},${BOUNDS.tempMax}]` });

  let db;
  try { db = admin(); } catch (e) { return res.status(500).json({ error: e.message }); }

  // Resolve the device → bin on the server; never trust a client-asserted bin id.
  const devSnap = await db.collection("iot_devices").where("deviceId", "==", deviceId).limit(1).get();
  const devDoc = devSnap.empty ? null : devSnap.docs[0];
  if (!devDoc) return res.status(404).json({ error: "Unknown device" });
  const dev = devDoc.data();
  if (dev.disabled === true) return res.status(403).json({ error: "Device disabled" });
  if (!dev.deviceKeyHash || !keysMatch(deviceKey, dev.deviceKeyHash)) return res.status(403).json({ error: "Invalid device key" });
  if (!dev.binId) return res.status(409).json({ error: "Device is not linked to a bin" });

  const nowMs = Date.now();
  if (dev.lastSeenAt && nowMs - new Date(dev.lastSeenAt).getTime() < MIN_SECONDS_BETWEEN_READINGS * 1000) {
    return res.status(429).json({ error: `Too many readings — min ${MIN_SECONDS_BETWEEN_READINGS}s between readings` });
  }

  // Device clocks drift; accept its timestamp only if it is plausible, else stamp on arrival.
  const deviceTs = body.timestamp ? new Date(body.timestamp) : null;
  const plausible = deviceTs && !Number.isNaN(deviceTs.getTime()) && Math.abs(nowMs - deviceTs.getTime()) < 10 * 60 * 1000;
  const timestamp = (plausible ? deviceTs : new Date(nowMs)).toISOString();
  const receivedAt = new Date(nowMs).toISOString();

  const reading = {
    bin_id: dev.binId, device_id: deviceId,
    fill_level_percent: fill, temperature_celsius: temp,
    battery_level: num(body.battery_level), signal: num(body.signal),
    timestamp, receivedAt, source: "device",
  };

  const batch = db.batch();
  batch.set(db.collection("sensor_readings").doc(), reading);
  const binUpdate = { lastReadingAt: timestamp, lastDeviceId: deviceId };
  if (fill != null) binUpdate.lastFillLevelPercent = fill;
  if (temp != null) binUpdate.lastTemperatureCelsius = temp;
  if (reading.battery_level != null) binUpdate.lastBatteryLevel = reading.battery_level;
  batch.update(db.collection("bins").doc(dev.binId), binUpdate);
  batch.update(devDoc.ref, { lastSeenAt: receivedAt, readingsCount: FieldValue.increment(1) });
  await batch.commit();

  return res.status(201).json({ ok: true, bin_id: dev.binId, timestamp });
}

function safeJson(s) { try { return JSON.parse(s); } catch { return {}; } }
