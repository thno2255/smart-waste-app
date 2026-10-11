/**
 * seedFirestore.js
 * ─────────────────────────────────────────────────────────────────────
 * One-time seed function.
 * - Creates initial documents in every missing collection.
 * - Writes analytics/* docs (setDoc — always overwrites with fresh data).
 * - Seeds fire_sensors collection (12 districts).
 *
 * Usage: call seedAllCollections() once from SettingsPage.
 * Safe to call again — collections with existing data are skipped,
 * but analytics/* docs are always refreshed.
 * ─────────────────────────────────────────────────────────────────────
 */

import { collection, addDoc, getDocs, query, limit, doc, setDoc, getDoc, updateDoc, writeBatch, where } from "firebase/firestore";
import { db } from "./firebase";
import { COLLECTIONS, applyRouteReconciliation } from "./firestoreService";
import { normalizeNeighborhoodName } from "./config";
import { getBinPriority, pointInPolygon, polygonCentroid, reconcileRecommendations } from "./decisionEngine";
import buraidahNeighborhoodsGeo from "./buraidahNeighborhoods.geo.json";

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

/** Write an analytics document ONLY if it doesn't exist yet — protects real data */
async function setAnalyticsDoc(docId, data) {
  const ref  = doc(db, "analytics", docId);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    console.log(`[seed] analytics/${docId} — already exists, skipping.`);
    return;
  }
  await setDoc(ref, { ...data, updatedAt: ts() });
  console.log(`[seed] analytics/${docId} — set ✓`);
}

export async function seedAllCollections() {
  const results = {};

  // ── neighborhoods (replaces the old unused "districts" collection) ──
  results.neighborhoods = await seedOnce(COLLECTIONS.NEIGHBORHOODS, {
    name:      "حي الخليج",
    city:      "بريدة",
    boundary:  null, // GeoJSON.Polygon — filled in by the map phase
    centerLat: null,
    centerLng: null,
  });

  // ── bins (replaces the old embedded stations[].containers[]) ────────
  results.bins = await seedOnce(COLLECTIONS.BINS, {
    name:                   "حاوية تجريبية 1",
    neighborhoodId:         "sample-neighborhood-1",
    lat:                    null,
    lng:                    null,
    wasteType:              "مختلط",
    capacityLiters:         1100,
    deviceId:               null,
    status:                 "normal",
    lastFillLevelPercent:   42,
    lastTemperatureCelsius: 28,
    lastReadingAt:          null,
  });

  // ── iot_devices ───────────────────────────────────────────────────
  results.iot_devices = await seedOnce(COLLECTIONS.IOT_DEVICES, {
    binId:      "sample-bin-1",
    deviceKey:  "demo-key-change-me",
    label:      "ESP32-DEMO-01",
    lastSeenAt: null,
  });

  // ── sensors (legacy/unused collection — left as-is) ──────────────────
  results.sensors = await seedOnce("sensors", {
    containerId:  "sample-container-1",
    stationId:    "sample-station-1",
    type:         "fill_level",
    value:        42,
    unit:         "%",
    lastReading:  ts(),
  });

  // ── alerts ─────────────────────────────────────────────────────────
  results.alerts = await seedOnce("alerts", {
    stationId:   "sample-station-1",
    stationName: "محطة الخليج الرئيسية",
    type:        "تحذير",
    message:     "مستوى الامتلاء وصل 65% — يُنصح بجدولة شفط",
    severity:    "medium",
    resolved:    false,
  });

  // ── fire_alerts ────────────────────────────────────────────────────
  results.fire_alerts = await seedOnce("fire_alerts", {
    stationId:     "sample-station-1",
    stationName:   "محطة الخليج الرئيسية",
    temperature:   32,
    gasLevel:      12,
    smokeDetected: false,
    riskLevel:     "آمن",
    resolved:      false,
  });

  // ── requests ──────────────────────────────────────────────────────
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

  // ── fire_sensors (12 محطة — واحدة لكل حي) ─────────────────────────
  const hasFireSensors = await hasDocuments("fire_sensors");
  if (!hasFireSensors) {
    const fireSensorsData = [
      { district: "حي الخليج",   internalTemp: 34, ambientTemp: 41, gasLevel: 12, humidity: 38, smokeDetected: false, sparkDetected: false, riskScore: 18, riskLevel: "آمن",         fireExtinguisher: true,  autoSuppression: true,  lastInspection: "5 أيام"  },
      { district: "حي الفايزية", internalTemp: 42, ambientTemp: 43, gasLevel: 28, humidity: 34, smokeDetected: false, sparkDetected: false, riskScore: 32, riskLevel: "تحذير",       fireExtinguisher: true,  autoSuppression: false, lastInspection: "12 يوم" },
      { district: "حي الإسكان",  internalTemp: 58, ambientTemp: 44, gasLevel: 45, humidity: 30, smokeDetected: false, sparkDetected: false, riskScore: 55, riskLevel: "خطر متوسط",   fireExtinguisher: true,  autoSuppression: true,  lastInspection: "8 أيام"  },
      { district: "حي الريان",   internalTemp: 30, ambientTemp: 40, gasLevel:  8, humidity: 42, smokeDetected: false, sparkDetected: false, riskScore: 12, riskLevel: "آمن",         fireExtinguisher: true,  autoSuppression: true,  lastInspection: "3 أيام"  },
      { district: "حي السالمية", internalTemp: 72, ambientTemp: 45, gasLevel: 68, humidity: 28, smokeDetected: true,  sparkDetected: false, riskScore: 78, riskLevel: "خطر عالي",    fireExtinguisher: true,  autoSuppression: true,  lastInspection: "20 يوم" },
      { district: "حي الحمر",    internalTemp: 38, ambientTemp: 41, gasLevel: 18, humidity: 40, smokeDetected: false, sparkDetected: false, riskScore: 22, riskLevel: "آمن",         fireExtinguisher: true,  autoSuppression: true,  lastInspection: "7 أيام"  },
      { district: "حي المنتزه",  internalTemp: 48, ambientTemp: 43, gasLevel: 35, humidity: 32, smokeDetected: false, sparkDetected: false, riskScore: 42, riskLevel: "تحذير",       fireExtinguisher: false, autoSuppression: true,  lastInspection: "15 يوم" },
      { district: "حي الأفق",    internalTemp: 31, ambientTemp: 40, gasLevel: 10, humidity: 41, smokeDetected: false, sparkDetected: false, riskScore: 14, riskLevel: "آمن",         fireExtinguisher: true,  autoSuppression: true,  lastInspection: "4 أيام"  },
      { district: "حي النقع",    internalTemp: 65, ambientTemp: 44, gasLevel: 55, humidity: 27, smokeDetected: true,  sparkDetected: true,  riskScore: 72, riskLevel: "خطر عالي",    fireExtinguisher: true,  autoSuppression: false, lastInspection: "25 يوم" },
      { district: "حي الضاحي",   internalTemp: 52, ambientTemp: 43, gasLevel: 40, humidity: 31, smokeDetected: false, sparkDetected: false, riskScore: 48, riskLevel: "تحذير",       fireExtinguisher: true,  autoSuppression: true,  lastInspection: "11 يوم" },
      { district: "حي الهلالية", internalTemp: 33, ambientTemp: 41, gasLevel: 14, humidity: 39, smokeDetected: false, sparkDetected: false, riskScore: 16, riskLevel: "آمن",         fireExtinguisher: true,  autoSuppression: true,  lastInspection: "6 أيام"  },
      { district: "حي البصيرة",  internalTemp: 29, ambientTemp: 40, gasLevel:  7, humidity: 44, smokeDetected: false, sparkDetected: false, riskScore: 10, riskLevel: "آمن",         fireExtinguisher: true,  autoSuppression: true,  lastInspection: "2 يوم"  },
    ];
    for (const sd of fireSensorsData) {
      await addDoc(collection(db, "fire_sensors"), { ...sd, updatedAt: ts(), _seed: true });
    }
    console.log("[seed] fire_sensors — 12 docs seeded ✓");
    results.fire_sensors = true;
  } else {
    console.log('[seed] "fire_sensors" — already has data, skipping.');
    results.fire_sensors = false;
  }

  // ══════════════════════════════════════════════════════════════════
  // analytics/* — always overwrite so data stays fresh
  // ══════════════════════════════════════════════════════════════════

  // ── توزيع النفايات الأسبوعي (كجم) ────────────────────────────────
  await setAnalyticsDoc("weekly", {
    data: [
      { day: "الأحد",    عضوية: 280, بلاستيك: 130, ورق:  85, زجاج: 50, معادن: 35 },
      { day: "الإثنين",  عضوية: 310, بلاستيك: 145, ورق:  95, زجاج: 55, معادن: 40 },
      { day: "الثلاثاء", عضوية: 265, بلاستيك: 120, ورق:  78, زجاج: 42, معادن: 28 },
      { day: "الأربعاء", عضوية: 295, بلاستيك: 138, ورق:  90, زجاج: 48, معادن: 33 },
      { day: "الخميس",   عضوية: 330, بلاستيك: 155, ورق: 102, زجاج: 60, معادن: 45 },
      { day: "الجمعة",   عضوية: 210, بلاستيك:  98, ورق:  65, زجاج: 35, معادن: 22 },
      { day: "السبت",    عضوية: 245, بلاستيك: 115, ورق:  75, زجاج: 44, معادن: 30 },
    ],
  });

  // ── الاتجاه الشهري ────────────────────────────────────────────────
  await setAnalyticsDoc("monthly", {
    data: [
      { month: "يناير",   عمليات_الجمع: 242, الكفاءة: 71, التكلفة: 13200 },
      { month: "فبراير",  عمليات_الجمع: 258, الكفاءة: 74, التكلفة: 12800 },
      { month: "مارس",    عمليات_الجمع: 275, الكفاءة: 76, التكلفة: 12400 },
      { month: "أبريل",   عمليات_الجمع: 290, الكفاءة: 78, التكلفة: 12100 },
      { month: "مايو",    عمليات_الجمع: 310, الكفاءة: 80, التكلفة: 11800 },
      { month: "يونيو",   عمليات_الجمع: 328, الكفاءة: 82, التكلفة: 11500 },
      { month: "يوليو",   عمليات_الجمع: 345, الكفاءة: 84, التكلفة: 11200 },
      { month: "أغسطس",  عمليات_الجمع: 358, الكفاءة: 85, التكلفة: 10900 },
      { month: "سبتمبر", عمليات_الجمع: 372, الكفاءة: 87, التكلفة: 10600 },
      { month: "أكتوبر", عمليات_الجمع: 385, الكفاءة: 88, التكلفة: 10300 },
      { month: "نوفمبر", عمليات_الجمع: 398, الكفاءة: 90, التكلفة: 10000 },
      { month: "ديسمبر", عمليات_الجمع: 412, الكفاءة: 91, التكلفة:  9800 },
    ],
  });

  // ── نشاط الشفط على مدار الساعة ───────────────────────────────────
  await setAnalyticsDoc("hourly", {
    data: [
      { hour: "00:00", الشفط: 18, الضغط: 1.1 }, { hour: "01:00", الشفط: 14, الضغط: 1.0 },
      { hour: "02:00", الشفط: 12, الضغط: 0.9 }, { hour: "03:00", الشفط: 10, الضغط: 0.9 },
      { hour: "04:00", الشفط: 12, الضغط: 1.0 }, { hour: "05:00", الشفط: 20, الضغط: 1.2 },
      { hour: "06:00", الشفط: 38, الضغط: 1.8 }, { hour: "07:00", الشفط: 62, الضغط: 2.4 },
      { hour: "08:00", الشفط: 78, الضغط: 2.9 }, { hour: "09:00", الشفط: 82, الضغط: 3.1 },
      { hour: "10:00", الشفط: 75, الضغط: 2.8 }, { hour: "11:00", الشفط: 68, الضغط: 2.6 },
      { hour: "12:00", الشفط: 55, الضغط: 2.2 }, { hour: "13:00", الشفط: 50, الضغط: 2.0 },
      { hour: "14:00", الشفط: 58, الضغط: 2.3 }, { hour: "15:00", الشفط: 70, الضغط: 2.7 },
      { hour: "16:00", الشفط: 80, الضغط: 3.0 }, { hour: "17:00", الشفط: 85, الضغط: 3.2 },
      { hour: "18:00", الشفط: 72, الضغط: 2.8 }, { hour: "19:00", الشفط: 60, الضغط: 2.5 },
      { hour: "20:00", الشفط: 48, الضغط: 2.1 }, { hour: "21:00", الشفط: 38, الضغط: 1.7 },
      { hour: "22:00", الشفط: 28, الضغط: 1.4 }, { hour: "23:00", الشفط: 20, الضغط: 1.2 },
    ],
  });

  // ── تاريخ درجات الحرارة (24 ساعة) ───────────────────────────────
  await setAnalyticsDoc("fire_temp", {
    data: [
      { hour: "00:00", الحرارة_الداخلية: 36, الحرارة_الخارجية: 34, حد_الإنذار: 60, حد_الخطر: 75 },
      { hour: "01:00", الحرارة_الداخلية: 35, الحرارة_الخارجية: 33, حد_الإنذار: 60, حد_الخطر: 75 },
      { hour: "02:00", الحرارة_الداخلية: 34, الحرارة_الخارجية: 32, حد_الإنذار: 60, حد_الخطر: 75 },
      { hour: "03:00", الحرارة_الداخلية: 34, الحرارة_الخارجية: 31, حد_الإنذار: 60, حد_الخطر: 75 },
      { hour: "04:00", الحرارة_الداخلية: 33, الحرارة_الخارجية: 31, حد_الإنذار: 60, حد_الخطر: 75 },
      { hour: "05:00", الحرارة_الداخلية: 34, الحرارة_الخارجية: 32, حد_الإنذار: 60, حد_الخطر: 75 },
      { hour: "06:00", الحرارة_الداخلية: 36, الحرارة_الخارجية: 34, حد_الإنذار: 60, حد_الخطر: 75 },
      { hour: "07:00", الحرارة_الداخلية: 39, الحرارة_الخارجية: 37, حد_الإنذار: 60, حد_الخطر: 75 },
      { hour: "08:00", الحرارة_الداخلية: 43, الحرارة_الخارجية: 40, حد_الإنذار: 60, حد_الخطر: 75 },
      { hour: "09:00", الحرارة_الداخلية: 48, الحرارة_الخارجية: 44, حد_الإنذار: 60, حد_الخطر: 75 },
      { hour: "10:00", الحرارة_الداخلية: 52, الحرارة_الخارجية: 47, حد_الإنذار: 60, حد_الخطر: 75 },
      { hour: "11:00", الحرارة_الداخلية: 56, الحرارة_الخارجية: 50, حد_الإنذار: 60, حد_الخطر: 75 },
      { hour: "12:00", الحرارة_الداخلية: 60, الحرارة_الخارجية: 52, حد_الإنذار: 60, حد_الخطر: 75 },
      { hour: "13:00", الحرارة_الداخلية: 62, الحرارة_الخارجية: 53, حد_الإنذار: 60, حد_الخطر: 75 },
      { hour: "14:00", الحرارة_الداخلية: 63, الحرارة_الخارجية: 54, حد_الإنذار: 60, حد_الخطر: 75 },
      { hour: "15:00", الحرارة_الداخلية: 61, الحرارة_الخارجية: 53, حد_الإنذار: 60, حد_الخطر: 75 },
      { hour: "16:00", الحرارة_الداخلية: 58, الحرارة_الخارجية: 51, حد_الإنذار: 60, حد_الخطر: 75 },
      { hour: "17:00", الحرارة_الداخلية: 55, الحرارة_الخارجية: 49, حد_الإنذار: 60, حد_الخطر: 75 },
      { hour: "18:00", الحرارة_الداخلية: 51, الحرارة_الخارجية: 46, حد_الإنذار: 60, حد_الخطر: 75 },
      { hour: "19:00", الحرارة_الداخلية: 47, الحرارة_الخارجية: 43, حد_الإنذار: 60, حد_الخطر: 75 },
      { hour: "20:00", الحرارة_الداخلية: 44, الحرارة_الخارجية: 40, حد_الإنذار: 60, حد_الخطر: 75 },
      { hour: "21:00", الحرارة_الداخلية: 42, الحرارة_الخارجية: 38, حد_الإنذار: 60, حد_الخطر: 75 },
      { hour: "22:00", الحرارة_الداخلية: 40, الحرارة_الخارجية: 37, حد_الإنذار: 60, حد_الخطر: 75 },
      { hour: "23:00", الحرارة_الداخلية: 38, الحرارة_الخارجية: 35, حد_الإنذار: 60, حد_الخطر: 75 },
    ],
  });

  // ── حوادث الحريق الأسبوعية ────────────────────────────────────────
  await setAnalyticsDoc("fire_weekly", {
    data: [
      { week: "الأسبوع 1", إنذارات: 6, حوادث_فعلية: 1, إنذارات_كاذبة: 3 },
      { week: "الأسبوع 2", إنذارات: 5, حوادث_فعلية: 0, إنذارات_كاذبة: 2 },
      { week: "الأسبوع 3", إنذارات: 4, حوادث_فعلية: 1, إنذارات_كاذبة: 2 },
      { week: "الأسبوع 4", إنذارات: 3, حوادث_فعلية: 0, إنذارات_كاذبة: 1 },
      { week: "الأسبوع 5", إنذارات: 4, حوادث_فعلية: 0, إنذارات_كاذبة: 2 },
      { week: "الأسبوع 6", إنذارات: 2, حوادث_فعلية: 0, إنذارات_كاذبة: 1 },
      { week: "الأسبوع 7", إنذارات: 3, حوادث_فعلية: 0, إنذارات_كاذبة: 1 },
      { week: "الأسبوع 8", إنذارات: 1, حوادث_فعلية: 0, إنذارات_كاذبة: 1 },
    ],
  });

  // ── الأداء الربعي المالي ──────────────────────────────────────────
  await setAnalyticsDoc("quarterly", {
    data: [
      { quarter: "Q1", الإيرادات: 450000, التكاليف: 320000, الأرباح: 130000, الكفاءة: 78 },
      { quarter: "Q2", الإيرادات: 520000, التكاليف: 295000, الأرباح: 225000, الكفاءة: 84 },
      { quarter: "Q3", الإيرادات: 480000, التكاليف: 310000, الأرباح: 170000, الكفاءة: 81 },
      { quarter: "Q4", الإيرادات: 610000, التكاليف: 280000, الأرباح: 330000, الكفاءة: 91 },
    ],
  });

  // ── أداء الأحياء ──────────────────────────────────────────────────
  await setAnalyticsDoc("districts_perf", {
    data: [
      { district: "الخليج",   الأداء: 92, التكلفة: 28000, الرضا: 88, الحوادث: 1 },
      { district: "الفايزية", الأداء: 85, التكلفة: 32000, الرضا: 82, الحوادث: 3 },
      { district: "الإسكان",  الأداء: 78, التكلفة: 35000, الرضا: 75, الحوادث: 5 },
      { district: "الريان",   الأداء: 95, التكلفة: 25000, الرضا: 91, الحوادث: 0 },
      { district: "السالمية", الأداء: 71, التكلفة: 38000, الرضا: 68, الحوادث: 7 },
      { district: "الحمر",    الأداء: 83, التكلفة: 33000, الرضا: 80, الحوادث: 2 },
      { district: "المنتزه",  الأداء: 82, التكلفة: 31000, الرضا: 79, الحوادث: 4 },
      { district: "الأفق",    الأداء: 90, التكلفة: 27000, الرضا: 87, الحوادث: 1 },
      { district: "النقع",    الأداء: 75, التكلفة: 36000, الرضا: 72, الحوادث: 6 },
      { district: "الضاحي",   الأداء: 68, التكلفة: 42000, الرضا: 65, الحوادث: 8 },
      { district: "الهلالية", الأداء: 87, التكلفة: 30000, الرضا: 84, الحوادث: 2 },
      { district: "البصيرة",  الأداء: 93, التكلفة: 26000, الرضا: 90, الحوادث: 1 },
    ],
  });

  // ── بيانات العائد على الاستثمار ───────────────────────────────────
  await setAnalyticsDoc("roi", {
    data: [
      { month: "يناير",   العائد:  88000, الاستثمار: 62000, التوفير: 24000 },
      { month: "فبراير",  العائد:  92000, الاستثمار: 60000, التوفير: 28000 },
      { month: "مارس",    العائد:  97000, الاستثمار: 59000, التوفير: 32000 },
      { month: "أبريل",   العائد: 103000, الاستثمار: 58000, التوفير: 36000 },
      { month: "مايو",    العائد: 108000, الاستثمار: 57000, التوفير: 40000 },
      { month: "يونيو",   العائد: 115000, الاستثمار: 56000, التوفير: 44000 },
      { month: "يوليو",   العائد: 122000, الاستثمار: 55000, التوفير: 48000 },
      { month: "أغسطس",  العائد: 128000, الاستثمار: 54000, التوفير: 52000 },
      { month: "سبتمبر", العائد: 135000, الاستثمار: 53000, التوفير: 56000 },
      { month: "أكتوبر", العائد: 142000, الاستثمار: 52000, التوفير: 60000 },
      { month: "نوفمبر", العائد: 150000, الاستثمار: 51000, التوفير: 65000 },
      { month: "ديسمبر", العائد: 160000, الاستثمار: 50000, التوفير: 72000 },
    ],
  });

  // ── رضا المواطنين الشهري ─────────────────────────────────────────
  await setAnalyticsDoc("satisfaction", {
    data: [
      { month: "يناير",   الرضا: 70, الشكاوى: 28 },
      { month: "فبراير",  الرضا: 72, الشكاوى: 26 },
      { month: "مارس",    الرضا: 73, الشكاوى: 25 },
      { month: "أبريل",   الرضا: 75, الشكاوى: 23 },
      { month: "مايو",    الرضا: 76, الشكاوى: 21 },
      { month: "يونيو",   الرضا: 78, الشكاوى: 20 },
      { month: "يوليو",   الرضا: 79, الشكاوى: 18 },
      { month: "أغسطس",  الرضا: 80, الشكاوى: 17 },
      { month: "سبتمبر", الرضا: 82, الشكاوى: 15 },
      { month: "أكتوبر", الرضا: 83, الشكاوى: 14 },
      { month: "نوفمبر", الرضا: 85, الشكاوى: 12 },
      { month: "ديسمبر", الرضا: 87, الشكاوى: 10 },
    ],
  });

  // ── سجل الامتلاء الأسبوعي لكل حي ────────────────────────────────
  await setAnalyticsDoc("station_history", {
    data: {
      "حي الخليج":   [ {day:"الأحد",الامتلاء:42,الضغط:1.8,الكمية:120}, {day:"الإثنين",الامتلاء:48,الضغط:2.0,الكمية:135}, {day:"الثلاثاء",الامتلاء:55,الضغط:2.2,الكمية:148}, {day:"الأربعاء",الامتلاء:62,الضغط:2.4,الكمية:160}, {day:"الخميس",الامتلاء:70,الضغط:2.6,الكمية:175}, {day:"الجمعة",الامتلاء:38,الضغط:1.6,الكمية:95},  {day:"السبت",الامتلاء:44,الضغط:1.9,الكمية:115} ],
      "حي الفايزية": [ {day:"الأحد",الامتلاء:55,الضغط:2.1,الكمية:145}, {day:"الإثنين",الامتلاء:60,الضغط:2.3,الكمية:158}, {day:"الثلاثاء",الامتلاء:66,الضغط:2.5,الكمية:172}, {day:"الأربعاء",الامتلاء:72,الضغط:2.7,الكمية:185}, {day:"الخميس",الامتلاء:78,الضغط:2.9,الكمية:198}, {day:"الجمعة",الامتلاء:45,الضغط:1.8,الكمية:112}, {day:"السبت",الامتلاء:52,الضغط:2.0,الكمية:132} ],
      "حي الإسكان":  [ {day:"الأحد",الامتلاء:70,الضغط:2.6,الكمية:180}, {day:"الإثنين",الامتلاء:75,الضغط:2.8,الكمية:192}, {day:"الثلاثاء",الامتلاء:80,الضغط:3.0,الكمية:205}, {day:"الأربعاء",الامتلاء:85,الضغط:3.2,الكمية:218}, {day:"الخميس",الامتلاء:90,الضغط:3.4,الكمية:232}, {day:"الجمعة",الامتلاء:55,الضغط:2.2,الكمية:140}, {day:"السبت",الامتلاء:65,الضغط:2.5,الكمية:165} ],
      "حي الريان":   [ {day:"الأحد",الامتلاء:30,الضغط:1.4,الكمية:88},  {day:"الإثنين",الامتلاء:35,الضغط:1.6,الكمية:98},  {day:"الثلاثاء",الامتلاء:40,الضغط:1.8,الكمية:110}, {day:"الأربعاء",الامتلاء:45,الضغط:2.0,الكمية:122}, {day:"الخميس",الامتلاء:50,الضغط:2.1,الكمية:135}, {day:"الجمعة",الامتلاء:28,الضغط:1.3,الكمية:78},  {day:"السبت",الامتلاء:32,الضغط:1.5,الكمية:92}  ],
      "حي السالمية": [ {day:"الأحد",الامتلاء:82,الضغط:3.1,الكمية:215}, {day:"الإثنين",الامتلاء:86,الضغط:3.3,الكمية:228}, {day:"الثلاثاء",الامتلاء:89,الضغط:3.4,الكمية:240}, {day:"الأربعاء",الامتلاء:92,الضغط:3.5,الكمية:252}, {day:"الخميس",الامتلاء:95,الضغط:3.6,الكمية:265}, {day:"الجمعة",الامتلاء:65,الضغط:2.6,الكمية:168}, {day:"السبت",الامتلاء:75,الضغط:2.9,الكمية:192} ],
      "حي الحمر":    [ {day:"الأحد",الامتلاء:45,الضغط:1.9,الكمية:118}, {day:"الإثنين",الامتلاء:50,الضغط:2.1,الكمية:132}, {day:"الثلاثاء",الامتلاء:56,الضغط:2.3,الكمية:146}, {day:"الأربعاء",الامتلاء:61,الضغط:2.4,الكمية:158}, {day:"الخميس",الامتلاء:67,الضغط:2.6,الكمية:172}, {day:"الجمعة",الامتلاء:38,الضغط:1.7,الكمية:98},  {day:"السبت",الامتلاء:43,الضغط:1.9,الكمية:112} ],
      "حي المنتزه":  [ {day:"الأحد",الامتلاء:58,الضغط:2.3,الكمية:152}, {day:"الإثنين",الامتلاء:63,الضغط:2.5,الكمية:165}, {day:"الثلاثاء",الامتلاء:68,الضغط:2.7,الكمية:178}, {day:"الأربعاء",الامتلاء:73,الضغط:2.8,الكمية:190}, {day:"الخميس",الامتلاء:77,الضغط:3.0,الكمية:202}, {day:"الجمعة",الامتلاء:48,الضغط:2.0,الكمية:125}, {day:"السبت",الامتلاء:55,الضغط:2.2,الكمية:142} ],
      "حي الأفق":    [ {day:"الأحد",الامتلاء:32,الضغط:1.5,الكمية:92},  {day:"الإثنين",الامتلاء:37,الضغط:1.7,الكمية:105}, {day:"الثلاثاء",الامتلاء:42,الضغط:1.9,الكمية:118}, {day:"الأربعاء",الامتلاء:47,الضغط:2.1,الكمية:130}, {day:"الخميس",الامتلاء:52,الضغط:2.2,الكمية:142}, {day:"الجمعة",الامتلاء:30,الضغط:1.4,الكمية:82},  {day:"السبت",الامتلاء:35,الضغط:1.6,الكمية:98}  ],
      "حي النقع":    [ {day:"الأحد",الامتلاء:75,الضغط:2.9,الكمية:195}, {day:"الإثنين",الامتلاء:80,الضغط:3.0,الكمية:208}, {day:"الثلاثاء",الامتلاء:84,الضغط:3.2,الكمية:220}, {day:"الأربعاء",الامتلاء:88,الضغط:3.3,الكمية:232}, {day:"الخميس",الامتلاء:92,الضغط:3.5,الكمية:245}, {day:"الجمعة",الامتلاء:60,الضغط:2.4,الكمية:155}, {day:"السبت",الامتلاء:70,الضغط:2.7,الكمية:178} ],
      "حي الضاحي":   [ {day:"الأحد",الامتلاء:65,الضغط:2.5,الكمية:170}, {day:"الإثنين",الامتلاء:70,الضغط:2.7,الكمية:182}, {day:"الثلاثاء",الامتلاء:74,الضغط:2.8,الكمية:195}, {day:"الأربعاء",الامتلاء:78,الضغط:3.0,الكمية:208}, {day:"الخميس",الامتلاء:82,الضغط:3.2,الكمية:220}, {day:"الجمعة",الامتلاء:52,الضغط:2.2,الكمية:135}, {day:"السبت",الامتلاء:60,الضغط:2.4,الكمية:155} ],
      "حي الهلالية": [ {day:"الأحد",الامتلاء:38,الضغط:1.7,الكمية:105}, {day:"الإثنين",الامتلاء:43,الضغط:1.9,الكمية:118}, {day:"الثلاثاء",الامتلاء:48,الضغط:2.1,الكمية:130}, {day:"الأربعاء",الامتلاء:53,الضغط:2.2,الكمية:142}, {day:"الخميس",الامتلاء:58,الضغط:2.4,الكمية:155}, {day:"الجمعة",الامتلاء:35,الضغط:1.6,الكمية:95},  {day:"السبت",الامتلاء:40,الضغط:1.8,الكمية:110} ],
      "حي البصيرة":  [ {day:"الأحد",الامتلاء:28,الضغط:1.3,الكمية:82},  {day:"الإثنين",الامتلاء:32,الضغط:1.5,الكمية:92},  {day:"الثلاثاء",الامتلاء:37,الضغط:1.7,الكمية:105}, {day:"الأربعاء",الامتلاء:42,الضغط:1.9,الكمية:118}, {day:"الخميس",الامتلاء:47,الضغط:2.0,الكمية:130}, {day:"الجمعة",الامتلاء:25,الضغط:1.2,الكمية:72},  {day:"السبت",الامتلاء:30,الضغط:1.4,الكمية:88}  ],
    },
  });

  // ── مؤشرات الأداء التشغيلي ────────────────────────────────────────
  await setAnalyticsDoc("kpis", {
    data: [
      { label: "متوسط وقت الاستجابة", value: "12 دقيقة", target: "15 دقيقة", ok: true  },
      { label: "نسبة التشغيل",         value: "94.2%",    target: "90%",       ok: true  },
      { label: "معدل الأعطال",         value: "2.1%",     target: "3%",        ok: true  },
      { label: "رضا المستخدمين",       value: "87%",      target: "85%",       ok: true  },
    ],
  });

  // ── مؤشرات التأثير البيئي ─────────────────────────────────────────
  await setAnalyticsDoc("environment", {
    metrics: [
      { label: "انبعاثات CO₂ الموفرة",  value: "2.4 طن",    icon: "🌍", desc: "مقارنة بالطرق التقليدية"    },
      { label: "نسبة إعادة التدوير",    value: "68%",        icon: "♻️", desc: "من إجمالي النفايات"         },
      { label: "الطاقة الموفرة",        value: "1,200 kWh",  icon: "⚡", desc: "شهرياً"                     },
      { label: "تقليل الرحلات",         value: "45%",        icon: "🚛", desc: "انخفاض في رحلات النقل"      },
    ],
    goals: [
      { goal: "تقليل النفايات المرسلة للمرادم 50%", progress: 72 },
      { goal: "رفع نسبة إعادة التدوير إلى 80%",     progress: 68 },
      { goal: "خفض انبعاثات الكربون 30%",            progress: 85 },
      { goal: "تحقيق صفر نفايات بحلول 2030",         progress: 42 },
    ],
  });

  // ── القيم الفعلية الشهرية للتنبؤات (كجم/يوم) ─────────────────��──
  // تُحدَّث يدوياً من Firebase Console كل شهر
  await setAnalyticsDoc("actual_monthly", {
    data: {
      "يناير":   2550,
      "فبراير":  3380,
      "مارس":    3620,
      "أبريل":   3180,   // قراءة جزئية (19 من 30 يوم)
      "مايو":    null,
      "يونيو":   null,
      "يوليو":   null,
      "أغسطس":  null,
      "سبتمبر": null,
      "أكتوبر": null,
      "نوفمبر": null,
      "ديسمبر": null,
    },
  });

  results.analytics = true;
  console.log("[seed] analytics/* — all 12 docs written ✓");

  return results;
}

/**
 * migrateStationsToBinsAndNeighborhoods()
 * ─────────────────────────────────────────────────────────────────────
 * One-time, NON-DESTRUCTIVE migration from the old suction-model data
 * (stations + embedded containers[]) to the new smart-bin model
 * (neighborhoods + bins).
 *
 * - Reads every "stations" doc.
 * - Creates one "neighborhoods" doc per distinct station.district value
 *   (skips districts that already have a neighborhoods doc with the same
 *   name, so it's safe to run more than once).
 * - Creates one "bins" doc per embedded containers[] entry, carrying
 *   fillLevel over as lastFillLevelPercent (pressure has no bin analog
 *   and is dropped, not carried over). Each created bin is tagged with
 *   _migratedFromContainerId (the source container's id, or a composite
 *   station-id+name fallback for legacy containers with no id) — already-
 *   migrated containers are skipped on a re-run, so re-running this never
 *   creates duplicate bins.
 * - Does NOT delete or modify "stations" or their embedded containers —
 *   fully additive/reversible, so it can be reviewed in the Firebase
 *   console before any page is switched over to reading bins/neighborhoods.
 *
 * Usage: call once from SettingsPage (same manual-trigger pattern as
 * seedAllCollections()).
 */
export async function migrateStationsToBinsAndNeighborhoods() {
  const stationsSnap = await getDocs(collection(db, "stations"));
  const stations = stationsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  // Existing neighborhoods, keyed by name, so re-running this is idempotent.
  const neighborhoodsSnap = await getDocs(collection(db, COLLECTIONS.NEIGHBORHOODS));
  const neighborhoodIdByName = {};
  neighborhoodsSnap.docs.forEach(d => {
    neighborhoodIdByName[d.data().name] = d.id;
  });

  // Bins already created by a previous run of this migration, keyed by the
  // source container's id (or a station-id+name fallback) — so a re-run
  // skips containers it has already migrated instead of duplicating them.
  const binsSnap = await getDocs(collection(db, COLLECTIONS.BINS));
  const migratedContainerKeys = new Set(
    binsSnap.docs.map(d => d.data()._migratedFromContainerId).filter(Boolean)
  );

  let neighborhoodsCreated = 0;
  let binsCreated = 0;
  let binsSkipped = 0;

  for (const station of stations) {
    const districtName = station.district || "غير محدد";

    let neighborhoodId = neighborhoodIdByName[districtName];
    if (!neighborhoodId) {
      const ref = await addDoc(collection(db, COLLECTIONS.NEIGHBORHOODS), {
        name:      districtName,
        city:      "بريدة",
        boundary:  null,
        centerLat: null,
        centerLng: null,
        createdAt: ts(),
        _migratedFrom: "stations",
      });
      neighborhoodId = ref.id;
      neighborhoodIdByName[districtName] = neighborhoodId;
      neighborhoodsCreated += 1;
    }

    const containers = Array.isArray(station.containers) ? station.containers : [];
    for (const container of containers) {
      const containerKey = container.id || `${station.id}::${container.name || ""}`;
      if (migratedContainerKeys.has(containerKey)) {
        binsSkipped += 1;
        continue;
      }

      await addDoc(collection(db, COLLECTIONS.BINS), {
        name:                   container.name || `حاوية ${station.name || ""}`.trim(),
        neighborhoodId,
        lat:                    null,
        lng:                    null,
        wasteType:              station.wasteType || "مختلط",
        capacityLiters:         1100,
        deviceId:               null,
        status:                 "normal",
        lastFillLevelPercent:   Number(container.fillLevel) || 0,
        lastTemperatureCelsius: null,
        lastReadingAt:          null,
        createdAt:              ts(),
        _migratedFrom:          `stations/${station.id}`,
        _migratedFromContainerId: containerKey,
      });
      migratedContainerKeys.add(containerKey); // guard against dup containerKeys within this same run
      binsCreated += 1;
    }
  }

  console.log(`[migrate] ${neighborhoodsCreated} neighborhoods + ${binsCreated} bins created (${binsSkipped} skipped, already migrated) from ${stations.length} stations ✓`);
  return { stationsRead: stations.length, neighborhoodsCreated, binsCreated, binsSkipped };
}

/**
 * seedCityDemoData()
 * ─────────────────────────────────────────────────────────────────────
 * City-scale demo dataset for the smart-bin model — ~100 bins across all
 * 14 real Buraidah neighborhoods in buraidahNeighborhoods.geo.json, every
 * bin placed INSIDE its neighborhood's real polygon, with a deliberate
 * operational story so a judging panel sees the problem at a glance:
 *   - 3 neighborhoods in a critical state (clusters of nearly-full bins,
 *     one of them far from the depot to show distance-aware ordering)
 *   - 2 neighborhoods at high priority, 2 with active thermal alerts
 *   - one offline-heavy neighborhood (renders grey — "no reliable data")
 *   - bins with rising sensor history (prediction engine), a collection
 *     reset, a fault reading, no-sensor bins, a low-battery device
 *   - 4 vehicles with a depot position + suggested routes already linked
 *     to the critical/high bins (status "suggested" only — approval stays
 *     a human action).
 *
 * Re-runnable: every doc is tagged demo:true/_demoSeedVersion, and a run
 * first removes the previous demo set, then collapses duplicate neighborhood
 * docs (migration + older seeds created several docs with the same name,
 * which drew the same map polygon twice and hid its real color).
 * Legacy migrated bins and the human-approved routes are left untouched.
 */
const DEMO_SEED_VERSION = "v2-city";

/** Small deterministic PRNG (mulberry32) so bin positions/fills are stable between runs. */
function rngFor(seedText) {
  let h = 1779033703 ^ seedText.length;
  for (let i = 0; i < seedText.length; i++) {
    h = Math.imul(h ^ seedText.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function featureFor(baseName) {
  return buraidahNeighborhoodsGeo.features.find((f) => f.properties.baseName === baseName) || null;
}

/** A point inside the neighborhood's real polygon (rejection sampling over its bbox), deterministic per bin. */
function positionInside(baseName, index) {
  const feature = featureFor(baseName);
  if (!feature) return { lat: 26.3612, lng: 43.9744 };
  const ring = feature.geometry.coordinates[0];
  const lats = ring.map((c) => c[1]), lngs = ring.map((c) => c[0]);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const rand = rngFor(`${baseName}#${index}`);
  for (let tries = 0; tries < 200; tries++) {
    const lat = minLat + rand() * (maxLat - minLat);
    const lng = minLng + rand() * (maxLng - minLng);
    if (pointInPolygon(lat, lng, feature.geometry)) return { lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) };
  }
  const c = polygonCentroid(feature.geometry);
  return { lat: Number(c.lat.toFixed(6)), lng: Number(c.lng.toFixed(6)) };
}

const hoursAgoIso = (h) => new Date(Date.now() - h * 3600000).toISOString();

/** Rising history ending at `endPct` now — gives the prediction engine a real slope. */
function risingHistory(startPct, endPct, hoursSpan, points = 5) {
  return Array.from({ length: points }, (_, i) => {
    const frac = i / (points - 1);
    return { fill_level_percent: Math.round(startPct + (endPct - startPct) * frac), temperature_celsius: 26 + Math.round(frac * 3), hoursAgo: hoursSpan * (1 - frac) };
  });
}

/** Flat history — a normal bin must not trigger a "soon full" prediction. */
function stableHistory(pct, hoursSpan = 4, points = 4) {
  return Array.from({ length: points }, (_, i) => ({ fill_level_percent: pct + (i % 2 === 0 ? 0 : 1), temperature_celsius: 25, hoursAgo: hoursSpan * (1 - i / (points - 1)) }));
}

/** One collection reset inside the window — fill-rate must ignore the pre-reset segment. */
function resetHistory(currentPct) {
  return [
    { fill_level_percent: 81, temperature_celsius: 27, hoursAgo: 8 },
    { fill_level_percent: 93, temperature_celsius: 28, hoursAgo: 6 },
    { fill_level_percent: 5, temperature_celsius: 25, hoursAgo: 5.5 },
    { fill_level_percent: Math.max(6, currentPct - 9), temperature_celsius: 25, hoursAgo: 3 },
    { fill_level_percent: currentPct, temperature_celsius: 26, hoursAgo: 0.2 },
  ];
}

// Bin "kinds" — each expands into fill/temp/connectivity/history. `fill` may be a [min,max] range (deterministic pick).
const KIND = {
  normal:   (r) => ({ fill: 10 + Math.round(r() * 35), temp: 24 + Math.round(r() * 5), connectivity: "online", history: "stable" }),
  medium:   (r) => ({ fill: 60 + Math.round(r() * 12), temp: 26 + Math.round(r() * 6), connectivity: "online", history: "stable" }),
  high:     (r) => ({ fill: 76 + Math.round(r() * 8), temp: 27 + Math.round(r() * 6), connectivity: "online", history: "rising-slow" }),
  critical: (r) => ({ fill: 87 + Math.round(r() * 11), temp: 28 + Math.round(r() * 8), connectivity: "online", history: "rising" }),
  soon:     (r) => ({ fill: 66 + Math.round(r() * 6), temp: 27, connectivity: "online", history: "rising-fast" }),
  hot:      (r) => ({ fill: 70 + Math.round(r() * 12), temp: 58 + Math.round(r() * 8), connectivity: "online", history: "stable" }),
  offline:  (r) => ({ fill: 58 + Math.round(r() * 22), temp: 26, connectivity: "offline" }),
  fault:    () => ({ fill: 150, temp: 27, connectivity: "fault" }),
  noSensor: (r) => ({ fill: 15 + Math.round(r() * 30), temp: null, connectivity: "no_sensor" }),
  reset:    () => ({ fill: 24, temp: 26, connectivity: "online", history: "reset" }),
  lowBatt:  (r) => ({ fill: 30 + Math.round(r() * 20), temp: 25, connectivity: "online", history: "stable", battery: 9 }),
};

// The city story. Thermal alerts come from the existing fire_sensors seed
// (حي السالمية / حي النقع = "خطر عالي", حي الإسكان = "خطر متوسط").
const CITY_SPECS = [
  { baseName: "الإسكان", story: "حي حرج — تجمّع حاويات شبه ممتلئة",            kinds: ["critical", "critical", "critical", "critical", "critical", "high", "medium", "normal"] },
  { baseName: "النقع",   story: "حي حرج + تنبيه حراري + مستشعر معطّل",           kinds: ["critical", "critical", "critical", "high", "medium", "fault", "normal"] },
  { baseName: "الروابي", story: "حي حرج بعيد عن المستودع — ترتيب حسب المسافة",  kinds: ["critical", "critical", "critical", "high", "high", "normal", "normal"] },
  { baseName: "الحمراء", story: "أولوية مرتفعة + حاوية متوقع امتلاؤها قريبًا",  kinds: ["high", "high", "high", "soon", "medium", "medium", "normal", "normal"] },
  { baseName: "السالمية", story: "تنبيه حراري نشط + حاويات ساخنة",               kinds: ["hot", "hot", "medium", "medium", "reset", "normal"] },
  { baseName: "الفايزية", story: "يحتاج متابعة + تنبؤ امتلاء",                   kinds: ["medium", "medium", "medium", "soon", "normal", "normal", "normal", "noSensor"] },
  { baseName: "الخليج",  story: "أغلب المستشعرات غير متصلة — بيانات غير موثوقة", kinds: ["offline", "offline", "offline", "offline", "normal", "normal"] },
  { baseName: "الريان",  story: "حي طبيعي — يحوي حاوية العرض BIN-001",            kinds: ["bin001", "normal", "normal", "normal", "normal", "lowBatt"] },
  { baseName: "الأفق",   story: "حي طبيعي",                                      kinds: ["normal", "normal", "normal", "normal", "normal", "medium"] },
  { baseName: "النخيل",  story: "مختلط",                                         kinds: ["normal", "normal", "normal", "normal", "medium", "medium", "noSensor", "offline"] },
  { baseName: "الشروق",  story: "حي طبيعي",                                      kinds: ["normal", "normal", "normal", "normal", "normal", "medium"] },
  { baseName: "البساتين", story: "يحتاج متابعة",                                 kinds: ["medium", "medium", "medium", "high", "normal", "normal", "normal"] },
  { baseName: "النقيب",  story: "حي طبيعي في أقصى الشمال + مستشعر غير متصل",     kinds: ["normal", "normal", "normal", "normal", "medium", "offline"] },
  { baseName: "السلامة", story: "يحتاج متابعة",                                  kinds: ["medium", "medium", "high", "normal", "normal", "normal"] },
];

const DEPOT = { lat: 26.3340, lng: 43.9720, label: "المستودع الرئيسي — بريدة (موقع افتراضي للعرض)" };

const DEMO_VEHICLES = [
  { vehicleNumber: "مركبة جمع 1", status: "available",   capacityLiters: 6000, driverName: "سائق تجريبي" },
  { vehicleNumber: "مركبة جمع 2", status: "available",   capacityLiters: 6000, driverName: null },
  { vehicleNumber: "مركبة جمع 3", status: "maintenance", capacityLiters: 5000, driverName: null },
  { vehicleNumber: "مركبة جمع 4", status: "available",   capacityLiters: 8000, driverName: null },
];

function expandKind(kind, rand, baseName, index) {
  if (kind === "bin001") return { label: "BIN-001", fill: 55, temp: 27, connectivity: "online", history: "stable" };
  const spec = KIND[kind](rand);
  return { label: `حاوية ${baseName} ${index + 1}`, ...spec };
}

function historyFor(spec) {
  switch (spec.history) {
    case "rising":      return risingHistory(Math.max(5, spec.fill - 45), spec.fill, 7);
    case "rising-slow": return risingHistory(Math.max(5, spec.fill - 20), spec.fill, 8);
    case "rising-fast": return risingHistory(Math.max(5, spec.fill - 30), spec.fill, 2.5, 6);
    case "stable":      return stableHistory(spec.fill);
    case "reset":       return resetHistory(spec.fill);
    default:            return null;
  }
}

async function deleteDocsInBatches(refs) {
  for (let i = 0; i < refs.length; i += 400) {
    const batch = writeBatch(db);
    refs.slice(i, i + 400).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
}

/** Step 1 — remove the previous demo set (any version). Legacy/migrated docs and human-approved routes are never touched. */
async function removePreviousDemoData() {
  const deletedBinIds = new Set();
  let deleted = 0;

  const demoBins = await getDocs(query(collection(db, COLLECTIONS.BINS), where("demo", "==", true)));
  demoBins.docs.forEach((d) => deletedBinIds.add(d.id));

  for (const col of [COLLECTIONS.BINS, COLLECTIONS.IOT_DEVICES, COLLECTIONS.SENSOR_READINGS]) {
    const snap = await getDocs(query(collection(db, col), where("demo", "==", true)));
    await deleteDocsInBatches(snap.docs.map((d) => d.ref));
    deleted += snap.size;
  }

  // Legacy demo vehicles created with random ids (before stable demo-vehicle-N ids) are removed once.
  const legacyVehicles = await getDocs(query(collection(db, COLLECTIONS.VEHICLES), where("demo", "==", true)));
  const legacyRefs = legacyVehicles.docs.filter((d) => !d.id.startsWith("demo-vehicle-")).map((d) => d.ref);
  await deleteDocsInBatches(legacyRefs);
  deleted += legacyRefs.length;

  // Routes/events that referenced the removed bins would otherwise dangle.
  const routesSnap = await getDocs(collection(db, COLLECTIONS.COLLECTION_ROUTES));
  const danglingRoutes = routesSnap.docs.filter((d) => {
    const r = d.data();
    if (r.demo === true) return true;
    const referencesDeleted = (r.binIds || []).some((id) => deletedBinIds.has(id));
    return referencesDeleted && r.status !== "completed"; // completed history stays as a record
  });
  await deleteDocsInBatches(danglingRoutes.map((d) => d.ref));
  deleted += danglingRoutes.length;

  const eventsSnap = await getDocs(collection(db, COLLECTIONS.COLLECTION_EVENTS));
  const danglingEvents = eventsSnap.docs.filter((d) => deletedBinIds.has(d.data().binId) || d.data().demo === true);
  await deleteDocsInBatches(danglingEvents.map((d) => d.ref));
  deleted += danglingEvents.length;

  for (const col of [COLLECTIONS.CITIZEN_REPORTS, COLLECTIONS.AUDIT_LOG]) {
    const snap = await getDocs(query(collection(db, col), where("demo", "==", true)));
    await deleteDocsInBatches(snap.docs.map((d) => d.ref));
    deleted += snap.size;
  }

  // Open alerts are derived state — they regenerate from live bins within seconds (syncAlertsFromCandidates).
  const alertsSnap = await getDocs(query(collection(db, COLLECTIONS.ALERTS), where("resolved", "==", false)));
  await deleteDocsInBatches(alertsSnap.docs.map((d) => d.ref));
  deleted += alertsSnap.size;

  return { deleted };
}

/**
 * Step 2 — one neighborhood doc per real neighborhood. Duplicates (same
 * normalized name) are collapsed: bins are re-pointed to the kept doc and
 * the extras are deleted. Missing ones of the 14 real polygons are created.
 * Every kept doc gets its real polygon centroid and a standard "حي X" name.
 */
async function reconcileNeighborhoodDocs() {
  const snap = await getDocs(collection(db, COLLECTIONS.NEIGHBORHOODS));
  const all = snap.docs.map((d) => ({ id: d.id, ref: d.ref, ...d.data() }));
  const byKey = new Map();
  for (const n of all) {
    const key = normalizeNeighborhoodName(n.name);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(n);
  }

  const keptIdByKey = {};
  let merged = 0, created = 0;

  for (const [key, docs] of byKey.entries()) {
    docs.sort((a, b) => (Number(!!a.demo) - Number(!!b.demo)) || ((a.createdAt || "") < (b.createdAt || "") ? -1 : 1));
    const keep = docs[0];
    keptIdByKey[key] = keep.id;
    const extras = docs.slice(1);
    if (extras.length > 0) {
      const binsSnap = await getDocs(query(collection(db, COLLECTIONS.BINS), where("neighborhoodId", "in", extras.map((e) => e.id).slice(0, 10))));
      const batch = writeBatch(db);
      binsSnap.docs.forEach((b) => batch.update(b.ref, { neighborhoodId: keep.id }));
      extras.forEach((e) => batch.delete(e.ref));
      await batch.commit();
      merged += extras.length;
    }
    const feature = featureFor(key);
    const center = feature ? polygonCentroid(feature.geometry) : null;
    await updateDoc(keep.ref, {
      name: `حي ${key}`, city: "بريدة",
      centerLat: center ? Number(center.lat.toFixed(6)) : keep.centerLat ?? null,
      centerLng: center ? Number(center.lng.toFixed(6)) : keep.centerLng ?? null,
      boundarySource: feature ? (feature.properties.source || "openstreetmap") : null,
      demo: false,
    });
  }

  for (const feature of buraidahNeighborhoodsGeo.features) {
    const key = feature.properties.baseName;
    if (keptIdByKey[key]) continue;
    const center = polygonCentroid(feature.geometry);
    const ref = await addDoc(collection(db, COLLECTIONS.NEIGHBORHOODS), {
      name: `حي ${key}`, city: "بريدة", boundary: null,
      centerLat: Number(center.lat.toFixed(6)), centerLng: Number(center.lng.toFixed(6)),
      boundarySource: feature.properties.source || "openstreetmap",
      demo: false, createdAt: ts(),
    });
    keptIdByKey[key] = ref.id;
    created += 1;
  }

  return { keptIdByKey, merged, created };
}

export async function seedCityDemoData() {
  const cleanup = await removePreviousDemoData();
  const { keptIdByKey, merged, created: neighborhoodsCreated } = await reconcileNeighborhoodDocs();

  let binsCreated = 0, readingsCreated = 0;
  const seededBins = [];      // {bin, readings} — scored below to build the linked suggested routes
  const neighborhoodDocs = []; // minimal {id, name} for the route engine

  for (const spec of CITY_SPECS) {
    const neighborhoodId = keptIdByKey[spec.baseName];
    if (!neighborhoodId) continue;
    neighborhoodDocs.push({ id: neighborhoodId, name: `حي ${spec.baseName}` });

    const batch = writeBatch(db);
    const rand = rngFor(`city-${spec.baseName}`);
    spec.kinds.forEach((kind, i) => {
      const s = expandKind(kind, rand, spec.baseName, i);
      const pos = positionInside(spec.baseName, i);
      const hasDevice = s.connectivity !== "no_sensor";
      const isStale = s.connectivity === "offline";
      const lastReadingAt = hasDevice ? (isStale ? hoursAgoIso(2 + (i % 3)) : hoursAgoIso(0.02 + (i % 4) * 0.05)) : null;
      const deviceId = hasDevice ? `DEV-${spec.baseName}-${String(i + 1).padStart(2, "0")}` : null;

      const binRef = doc(collection(db, COLLECTIONS.BINS));
      const bin = {
        name: s.label, neighborhoodId, lat: pos.lat, lng: pos.lng,
        wasteType: ["مختلط", "عضوية", "بلاستيك", "ورق"][i % 4], capacityLiters: i % 5 === 0 ? 2400 : 1100,
        deviceId, status: "normal",
        lastFillLevelPercent: s.fill, lastTemperatureCelsius: s.temp, lastReadingAt,
        lastBatteryLevel: hasDevice ? (s.battery ?? 60 + ((i * 11) % 38)) : null,
        lastCollectionAt: hoursAgoIso(12 + (i * 9) % 80),
        demo: true, _demoSeedVersion: DEMO_SEED_VERSION, _demoStory: spec.story, createdAt: ts(),
      };
      batch.set(binRef, bin);
      binsCreated += 1;

      if (hasDevice) {
        batch.set(doc(collection(db, COLLECTIONS.IOT_DEVICES)), {
          binId: binRef.id, deviceId, deviceKey: "demo-key-not-for-production", deviceKeyHash: null, disabled: false, label: `ESP32-${deviceId}`,
          lastSeenAt: lastReadingAt, demo: true, _demoSeedVersion: DEMO_SEED_VERSION, createdAt: ts(),
        });
      }

      const history = hasDevice && !isStale ? historyFor(s) : null;
      const readings = [];
      if (history) {
        for (const h of history) {
          const reading = {
            bin_id: binRef.id, device_id: deviceId,
            fill_level_percent: h.fill_level_percent, temperature_celsius: h.temperature_celsius,
            battery_level: null, signal: null,
            timestamp: hoursAgoIso(h.hoursAgo), receivedAt: hoursAgoIso(h.hoursAgo),
            demo: true, _demoSeedVersion: DEMO_SEED_VERSION,
          };
          batch.set(doc(collection(db, COLLECTIONS.SENSOR_READINGS)), reading);
          readings.push(reading);
          readingsCreated += 1;
        }
      }
      seededBins.push({ bin: { id: binRef.id, ...bin }, readings });
    });
    await batch.commit();
  }

  // Stable doc ids (demo-vehicle-N) so re-seeding never orphans driver ↔ vehicle
  // assignments or routes that already point at these vehicles.
  for (let i = 0; i < DEMO_VEHICLES.length; i++) {
    const v = DEMO_VEHICLES[i];
    const ref = doc(db, COLLECTIONS.VEHICLES, `demo-vehicle-${i + 1}`);
    const prev = await getDoc(ref);
    await setDoc(ref, {
      ...v, depotLat: DEPOT.lat, depotLng: DEPOT.lng, depotLabel: DEPOT.label,
      currentRouteId: null, lastActiveAt: null,
      driverId: prev.exists() ? prev.data().driverId ?? null : null,
      driverName: prev.exists() ? prev.data().driverName ?? v.driverName ?? null : v.driverName ?? null,
      demo: true, _demoSeedVersion: DEMO_SEED_VERSION, createdAt: ts(),
    });
  }

  // ── Last-7-days history: completed routes, collection events, skips/incidents —
  // so "أداء السائقين والمركبات" and response-time metrics have real rows to compute from.
  const vehiclesSnap = await getDocs(query(collection(db, COLLECTIONS.VEHICLES), where("demo", "==", true)));
  const vehicleIds = vehiclesSnap.docs.map((d) => d.id);
  const history = await seedFleetHistory(seededBins, neighborhoodDocs, vehicleIds);

  // ── Open citizen reports that CONFIRM sensor data (§19 secondary signal):
  // two on الحمراء bins, one on النقع — the bins/neighborhood get a visible bump + reason.
  const reportTargets = [
    { base: "الحمراء", idx: 0, text: "الحاوية ممتلئة والأكياس على الأرض منذ أمس" },
    { base: "الحمراء", idx: 1, text: "رائحة قوية والحاوية لا تُغلق من الامتلاء" },
    { base: "النقع", idx: 3, text: "حاوية ممتلئة أمام المسجد" },
  ];
  let reportsCreated = 0;
  for (const t of reportTargets) {
    const target = seededBins.find(({ bin }) => bin.name === `حاوية ${t.base} ${t.idx + 1}`);
    if (!target) continue;
    await addDoc(collection(db, COLLECTIONS.CITIZEN_REPORTS), {
      userId: "demo-citizen", userName: "مواطن (تجريبي)", district: `حي ${t.base}`, type: "حاوية ممتلئة",
      description: t.text, location: `حي ${t.base} - بريدة`, binId: target.bin.id, binName: target.bin.name,
      status: "قيد المعالجة", response: "", demo: true, _demoSeedVersion: DEMO_SEED_VERSION, createdAt: hoursAgoIso(3 + reportsCreated),
    });
    reportsCreated += 1;
  }

  // Link the full bins to suggested routes right away (status "suggested" only —
  // approving/dispatching stays an explicit human action in the UI).
  const fireSnap = await getDocs(collection(db, "fire_sensors"));
  const thermal = new Set(fireSnap.docs.map((d) => d.data()).filter((s) => s.riskLevel === "خطر عالي" || s.riskLevel === "خطر متوسط").map((s) => normalizeNeighborhoodName(s.district)));
  const nameById = Object.fromEntries(neighborhoodDocs.map((n) => [n.id, n.name]));
  const scored = seededBins.map(({ bin, readings }) => ({
    bin, priority: getBinPriority(bin, null, readings, { thermalAlert: thermal.has(normalizeNeighborhoodName(nameById[bin.neighborhoodId] || "")) }),
  }));
  const openSnap = await getDocs(query(collection(db, COLLECTIONS.COLLECTION_ROUTES), where("status", "in", ["suggested", "approved", "in_progress"])));
  const openRoutes = openSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const plan = reconcileRecommendations(neighborhoodDocs, scored, openRoutes);
  const routeResult = await applyRouteReconciliation(plan, { demo: true, _demoSeedVersion: DEMO_SEED_VERSION });

  console.log(`[city-seed] cleaned ${cleanup.deleted} old docs, merged ${merged} duplicate neighborhoods, created ${neighborhoodsCreated} missing neighborhoods, ${binsCreated} bins, ${readingsCreated} readings, ${DEMO_VEHICLES.length} vehicles, ${routeResult.created} suggested routes, ${history.routes} completed routes, ${reportsCreated} citizen reports ✓`);
  return {
    neighborhoodsCreated, neighborhoodsMerged: merged, binsCreated, readingsCreated,
    vehiclesCreated: DEMO_VEHICLES.length, routesCreated: routeResult.created, cleaned: cleanup.deleted,
    historyRoutes: history.routes, citizenReports: reportsCreated,
  };
}

/**
 * Seven days of completed demo routes (one or two per day) with their
 * collection events and a few skips/incidents in the audit log — realistic
 * enough for per-vehicle/per-driver performance, on-time rates and the
 * approval→start response time to mean something. All tagged demo:true.
 */
async function seedFleetHistory(seededBins, neighborhoodDocs, vehicleIds) {
  if (vehicleIds.length === 0 || seededBins.length === 0) return { routes: 0 };
  const rand = rngFor("fleet-history");
  const drivers = [
    { id: "demo-driver-1", name: "سائق تجريبي" },
    { id: "demo-driver-2", name: "خالد (سائق تجريبي)" },
  ];
  const byNeighborhood = {};
  for (const { bin } of seededBins) (byNeighborhood[bin.neighborhoodId] ||= []).push(bin);
  const nIds = Object.keys(byNeighborhood);
  let created = 0;

  for (let day = 7; day >= 1; day--) {
    const runs = day % 3 === 0 ? 1 : 2;
    for (let k = 0; k < runs; k++) {
      const nid = nIds[Math.floor(rand() * nIds.length)];
      const nBins = byNeighborhood[nid].slice(0, 3 + Math.floor(rand() * 3));
      const vehicleId = vehicleIds[(day + k) % vehicleIds.length];
      const driver = drivers[(day + k) % drivers.length];
      const plannedKm = Math.round((2 + rand() * 6) * 10) / 10;
      const approvedAt = hoursAgoIso(day * 24 + 3 + k * 4);
      const startedAt = hoursAgoIso(day * 24 + 3 + k * 4 - (0.2 + rand() * 1.5));
      const durationH = (plannedKm / 30) + nBins.length * (4 / 60) + (rand() < 0.3 ? 0.6 : 0.1);
      const completedAt = new Date(new Date(startedAt).getTime() + durationH * 3600000).toISOString();
      const skipIdx = rand() < 0.35 ? Math.floor(rand() * nBins.length) : -1;

      const routeRef = await addDoc(collection(db, COLLECTIONS.COLLECTION_ROUTES), {
        routeName: `جولة ${neighborhoodDocs.find((n) => n.id === nid)?.name || "حي"} — ${day} يوم مضى`,
        neighborhoodIds: [nid], binIds: nBins.map((b) => b.id),
        orderedStops: nBins.map((b, i) => ({ order: i + 1, binId: b.id, binName: b.name, priorityTier: i === 0 ? "critical" : "high", priorityScore: 80 - i * 6, hasCoords: true })),
        priorityTier: "high", totalPriorityScore: 70 * nBins.length, estimatedDistanceKm: plannedKm, estimatedWasteLiters: nBins.length * 900,
        reasons: ["جولة تاريخية للعرض"], status: "completed", manualBinIds: [],
        approvedBy: "demo-supervisor", approvedAt, startedAt, completedAt, vehicleId, driverId: driver.id, driverName: driver.name,
        collectedBinIds: nBins.filter((_, i) => i !== skipIdx).map((b) => b.id),
        demo: true, _demoSeedVersion: DEMO_SEED_VERSION, createdAt: approvedAt,
      });
      const batch = writeBatch(db);
      nBins.forEach((b, i) => {
        if (i === skipIdx) {
          batch.set(doc(collection(db, COLLECTIONS.AUDIT_LOG)), { action: "route_stop_skipped", actorId: driver.id, actorName: driver.name, details: { routeId: routeRef.id, binId: b.id, routeName: "" }, demo: true, createdAt: completedAt });
          return;
        }
        batch.set(doc(collection(db, COLLECTIONS.COLLECTION_EVENTS)), {
          binId: b.id, routeId: routeRef.id, vehicleId, operatorId: driver.id,
          fillBefore: 72 + Math.round(rand() * 26), fillAfter: 0, source: "route",
          collectedAt: completedAt, createdAt: completedAt, demo: true, _demoSeedVersion: DEMO_SEED_VERSION,
        });
      });
      if (rand() < 0.25) {
        batch.set(doc(collection(db, COLLECTIONS.AUDIT_LOG)), { action: rand() < 0.5 ? "route_obstacle_reported" : "route_fault_reported", actorId: driver.id, actorName: driver.name, details: { routeId: routeRef.id, routeName: "" }, demo: true, createdAt: completedAt });
      }
      batch.set(doc(collection(db, COLLECTIONS.AUDIT_LOG)), { action: "route_completed", actorId: driver.id, actorName: driver.name, details: { routeId: routeRef.id, by: "driver" }, demo: true, createdAt: completedAt });
      await batch.commit();
      created += 1;
    }
  }
  return { routes: created };
}
