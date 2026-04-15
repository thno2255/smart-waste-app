/**
 * seedFirestore.js
 * ─────────────────────────────────────────────────────────────────────
 * One-time seed function.
 * Creates an initial document in every missing collection so that
 * Firebase shows the collection in its console.
 *
 * Usage: call seedAllCollections() once from SettingsPage.
 * Safe to call again — it only adds documents, never deletes anything.
 * ─────────────────────────────────────────────────────────────────────
 */

import { collection, addDoc, getDocs, query, limit } from "firebase/firestore";
import { db } from "./firebase";

const ts = () => new Date().toISOString();

/** Returns true if the collection already has at least one document */
async function hasDocuments(colName) {
  const snap = await getDocs(query(collection(db, colName), limit(1)));
  return !snap.empty;
}

/** Add a seed document only if the collection is empty */
async function seedOnce(colName, data) {
  const exists = await hasDocuments(colName);
  if (exists) {
    console.log(`[seed] "${colName}" — already has data, skipping.`);
    return false;
  }
  await addDoc(collection(db, colName), { ...data, createdAt: ts(), _seed: true });
  console.log(`[seed] "${colName}" — seeded ✓`);
  return true;
}

export async function seedAllCollections() {
  const results = {};

  // ── districts ──────────────────────────────────────────────────────
  results.districts = await seedOnce("districts", {
    name:         "حي الخليج",
    city:         "بريدة",
    fillLevel:    45,
    wasteTotal:   1200,
    performance:  88,
    stationCount: 3,
  });

  // ── sensors ────────────────────────────────────────────────────────
  results.sensors = await seedOnce("sensors", {
    containerId:  "sample-container-1",
    stationId:    "sample-station-1",
    type:         "fill_level",   // fill_level | temperature | gas | humidity
    value:        42,
    unit:         "%",
    lastReading:  ts(),
  });

  // ── alerts ─────────────────────────────────────────────────────────
  results.alerts = await seedOnce("alerts", {
    stationId:   "sample-station-1",
    stationName: "محطة الخليج الرئيسية",
    type:        "تحذير",         // حرج | تحذير | معلومة
    message:     "مستوى الامتلاء وصل 65% — يُنصح بجدولة شفط",
    severity:    "medium",        // high | medium | low
    resolved:    false,
  });

  // ── fire_alerts ────────────────────────────────────────────────────
  results.fire_alerts = await seedOnce("fire_alerts", {
    stationId:     "sample-station-1",
    stationName:   "محطة الخليج الرئيسية",
    temperature:   32,
    gasLevel:      12,
    smokeDetected: false,
    riskLevel:     "آمن",         // خطر عالي | خطر متوسط | تحذير | آمن
    resolved:      false,
  });

  // ── requests (citizen bin requests) ───────────────────────────────
  results.requests = await seedOnce("requests", {
    userId:    "sample-user-1",
    userName:  "محمد العتيبي",
    district:  "حي الخليج",
    address:   "شارع الملك فهد، بجوار مسجد النور",
    binType:   "مختلطة",
    notes:     "طلب تجريبي أولي",
    stationId: "",
    status:    "قيد المراجعة",
    response:  "",
  });

  // ── citizen_reports ────────────────────────────────────────────────
  results.citizen_reports = await seedOnce("citizen_reports", {
    userId:      "sample-user-1",
    userName:    "محمد العتيبي",
    district:    "حي الخليج",
    type:        "حاوية ممتلئة",
    description: "الحاوية أمام العمارة رقم 12 ممتلئة منذ يومين",
    location:    "حي الخليج - بريدة",
    status:      "قيد المعالجة",
    response:    "",
  });

  return results;
}
