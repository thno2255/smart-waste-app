/**
 * firestoreService.js
 * ─────────────────────────────────────────────────────────────────────
 * Centralized Firestore service layer for the Waste Management System.
 * Provides:
 *  - Collection name constants
 *  - Generic real-time hooks (useCollection, useCollectionWhere)
 *  - Typed CRUD functions for every collection
 *  - getStatus() utility
 * ─────────────────────────────────────────────────────────────────────
 */

import { useState, useEffect } from "react";
import {
  collection, addDoc, updateDoc, deleteDoc,
  doc, onSnapshot, query, where, orderBy,
  getDoc, getDocs, setDoc, writeBatch,
} from "firebase/firestore";
import { db } from "./firebase";
import { getStatus, getStatusColor, getBinStatus, THRESHOLDS } from "./config";

// ══════════════════════════════════════════════════════════════════════
// 1. Collection Names
//
// ⚠️ SECURITY GAP (documented, not yet resolved): there is no firestore.rules
// file anywhere in this repository — Firestore security rules exist only in
// the Firebase console and are entirely unmanaged/unversioned by this
// codebase. IOT_DEVICES, BINS, and SENSOR_READINGS below therefore inherit
// whatever the console's current (unknown-to-this-repo) rules allow.
// DO NOT implement the ESP32-facing write endpoint (planned /api/iot/readings)
// against these collections until: (1) current console rules are pulled into
// a versioned firestore.rules file in this repo, and (2) explicit rules are
// written for these collections (e.g. denying direct client writes to
// sensor_readings/bins status fields, since those must only be written
// server-side after device-key validation). This is a hard prerequisite for
// that phase, not a nice-to-have.
// ══════════════════════════════════════════════════════════════════════
export const COLLECTIONS = {
  STATIONS:        "stations",     // deprecated — retired in Phase 3, still read live by several pages
  NEIGHBORHOODS:   "neighborhoods", // replaces the old unused "districts" collection
  BINS:            "bins",          // replaces embedded stations[].containers[]
  IOT_DEVICES:     "iot_devices",
  SENSOR_READINGS: "sensor_readings",
  SENSORS:         "sensors",
  ALERTS:          "alerts",
  FIRE_ALERTS:     "fire_alerts",
  REPORTS:         "reports",
  REQUESTS:        "requests",
  CITIZEN_REPORTS: "citizen_reports",
  USERS:           "users",
  SUCTION_JOBS:    "suctionJobs", // deprecated — retired in Phase 3
};

// ══════════════════════════════════════════════════════════════════════
// 2. Status Logic  (single source of truth — re-exported from config.js,
//    which both App.jsx and this file import from, instead of each
//    keeping its own separate copy of the same thresholds)
// ══════════════════════════════════════════════════════════════════════
export { getStatus, getStatusColor, getBinStatus };

// ══════════════════════════════════════════════════════════════════════
// 3. Generic Hooks
// ══════════════════════════════════════════════════════════════════════

/**
 * Real-time hook for an entire collection.
 * @param {string} col  collection name
 * @param {string} [sortField="createdAt"]  optional sort field (desc)
 */
export function useCollection(col, sortField = "createdAt") {
  const [data, setData]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  useEffect(() => {
    if (!col) return;
    let q;
    try {
      q = sortField
        ? query(collection(db, col), orderBy(sortField, "desc"))
        : collection(db, col);
    } catch {
      q = collection(db, col);
    }

    const unsub = onSnapshot(
      q,
      (snap) => {
        setData(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      (err) => {
        console.error(`[useCollection:${col}]`, err);
        setError(err);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [col, sortField]);

  return { data, loading, error };
}

/**
 * Real-time hook filtered by a single field value.
 * Useful for "give me all requests where userId == X".
 * @param {string} col
 * @param {string} field
 * @param {*}      value  — if falsy, returns [] immediately
 * @param {string} [sortField="createdAt"]
 */
export function useCollectionWhere(col, field, value, sortField = "createdAt") {
  const [data, setData]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  useEffect(() => {
    if (!col || !value) { setLoading(false); return; }

    // NOTE: no orderBy here — combining where+orderBy requires a composite
    // Firestore index. We sort client-side instead to avoid SDK assertion errors.
    const q = query(collection(db, col), where(field, "==", value));

    const unsub = onSnapshot(
      q,
      (snap) => {
        let docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        if (sortField) {
          docs = docs.sort((a, b) => {
            const av = a[sortField] ?? "";
            const bv = b[sortField] ?? "";
            return bv > av ? 1 : bv < av ? -1 : 0;
          });
        }
        setData(docs);
        setLoading(false);
      },
      (err) => {
        console.error(`[useCollectionWhere:${col}]`, err);
        setError(err);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [col, field, value, sortField]);

  return { data, loading, error };
}

/**
 * Real-time hook for a single document inside the "analytics" collection.
 * Returns { data, loading } where data is the document fields (or null).
 * @param {string} docId  e.g. "weekly" | "monthly" | "hourly" | "fire_temp" …
 */
export function useAnalyticsDoc(docId) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!docId) return;
    const unsub = onSnapshot(
      doc(db, "analytics", docId),
      (snap) => {
        setData(snap.exists() ? snap.data() : null);
        setLoading(false);
      },
      (err) => {
        console.error(`[useAnalyticsDoc:${docId}]`, err);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [docId]);

  return { data, loading };
}

// ══════════════════════════════════════════════════════════════════════
// 4. Generic CRUD helpers
// ══════════════════════════════════════════════════════════════════════
const ts = () => new Date().toISOString();

/** Add a document to any collection */
export const addItem = (col, data) =>
  addDoc(collection(db, col), { ...data, createdAt: ts() });

/** Update a document in any collection */
export const updateItem = (col, id, data) =>
  updateDoc(doc(db, col, id), { ...data, updatedAt: ts() });

/** Delete a document from any collection */
export const deleteItem = (col, id) =>
  deleteDoc(doc(db, col, id));

// ══════════════════════════════════════════════════════════════════════
// 5. Stations
// ══════════════════════════════════════════════════════════════════════
export const addStation = (data) =>
  addItem(COLLECTIONS.STATIONS, {
    name:       data.name       || "",
    district:   data.district   || "",
    fillLevel:  Number(data.fillLevel)  || 0,
    pressure:   Number(data.pressure)   || 0,
    wasteType:  data.wasteType  || "مختلط",
    dailyWaste: Number(data.dailyWaste) || 0,
    containers: [],
  });

export const updateStation = (id, data) =>
  updateItem(COLLECTIONS.STATIONS, id, {
    name:       data.name,
    district:   data.district,
    fillLevel:  Number(data.fillLevel)  || 0,
    pressure:   Number(data.pressure)   || 0,
    wasteType:  data.wasteType,
    dailyWaste: Number(data.dailyWaste) || 0,
  });

export const deleteStation = (id) =>
  deleteItem(COLLECTIONS.STATIONS, id);

// ══════════════════════════════════════════════════════════════════════
// 6. Bins  (smart bins — top-level collection, replaces the embedded
//    stations[].containers[] array so each bin can be independently
//    geocoded, linked to a device, and joined against sensor_readings)
// ══════════════════════════════════════════════════════════════════════
export const addBin = (data) =>
  addItem(COLLECTIONS.BINS, {
    name:                 data.name                 || "",
    neighborhoodId:       data.neighborhoodId       || "",
    lat:                  data.lat                  ?? null,
    lng:                  data.lng                  ?? null,
    wasteType:            data.wasteType            || "مختلط",
    capacityLiters:       Number(data.capacityLiters) || 1100,
    deviceId:             data.deviceId             || null,
    status:               data.status               || "normal", // normal | warning | critical | offline | fault
    lastFillLevelPercent: data.lastFillLevelPercent ?? null,
    lastTemperatureCelsius: data.lastTemperatureCelsius ?? null,
    lastReadingAt:        data.lastReadingAt        ?? null,
  });

export const updateBin = (id, data) =>
  updateItem(COLLECTIONS.BINS, id, data);

export const deleteBin = (id) =>
  deleteItem(COLLECTIONS.BINS, id);

// ══════════════════════════════════════════════════════════════════════
// 7. Neighborhoods  (replaces the old unused "districts" collection)
// ══════════════════════════════════════════════════════════════════════
export const addNeighborhood = (data) =>
  addItem(COLLECTIONS.NEIGHBORHOODS, {
    name:      data.name      || "",
    city:      data.city      || "بريدة",
    boundary:  data.boundary  ?? null, // GeoJSON.Polygon, filled in by the map phase
    centerLat: data.centerLat ?? null,
    centerLng: data.centerLng ?? null,
  });

export const updateNeighborhood = (id, data) =>
  updateItem(COLLECTIONS.NEIGHBORHOODS, id, data);

export const deleteNeighborhood = (id) =>
  deleteItem(COLLECTIONS.NEIGHBORHOODS, id);

// ══════════════════════════════════════════════════════════════════════
// 8. Sensor readings  (append-only time-series, one doc per reading —
//    also updates the parent bin's denormalized latest-reading fields so
//    the dashboard/map never has to query sensor_readings directly)
// ══════════════════════════════════════════════════════════════════════
/**
 * Validates and records one sensor reading, atomically:
 *  - appends it to sensor_readings (historical record)
 *  - updates the parent bin's denormalized latest-reading fields + status
 * Both writes happen in a single batch — either both succeed or neither does,
 * so a bin can never end up referencing a reading that was never actually saved.
 *
 * Throws (does not write anything) if fill_level_percent/temperature_celsius
 * are missing or outside the configured plausible bounds — callers (including
 * the future ESP32 API route) are expected to reject/report the error rather
 * than have garbage values silently recorded as valid data.
 */
export const recordSensorReading = async (binId, deviceId, reading) => {
  const bounds = THRESHOLDS.faultReadingBounds;
  const fill = Number(reading?.fill_level_percent);
  if (Number.isNaN(fill) || fill < bounds.fillMin || fill > bounds.fillMax) {
    throw new Error(`recordSensorReading: fill_level_percent out of range/missing: ${reading?.fill_level_percent}`);
  }

  const hasTemp = reading?.temperature_celsius != null;
  const temp = hasTemp ? Number(reading.temperature_celsius) : null;
  if (hasTemp && (Number.isNaN(temp) || temp < bounds.tempMin || temp > bounds.tempMax)) {
    throw new Error(`recordSensorReading: temperature_celsius out of range: ${reading.temperature_celsius}`);
  }

  const data = {
    bin_id:               binId,
    device_id:            deviceId || "",
    fill_level_percent:   fill,
    temperature_celsius:  temp,
    battery_level:        reading?.battery_level ?? null,
    signal:               reading?.signal ?? null,
    timestamp:            reading?.timestamp || ts(),
    receivedAt:           ts(),
  };
  const status = getBinStatus({ deviceId }, data);

  const readingRef = doc(collection(db, COLLECTIONS.SENSOR_READINGS));
  const binRef = doc(db, COLLECTIONS.BINS, binId);
  const batch = writeBatch(db);
  batch.set(readingRef, data);
  batch.update(binRef, {
    lastFillLevelPercent:   data.fill_level_percent,
    lastTemperatureCelsius: data.temperature_celsius,
    lastReadingAt:          data.timestamp,
    status,
  });
  await batch.commit();

  return data;
};

// ══════════════════════════════════════════════════════════════════════
// 9. Alerts
// ══════════════════════════════════════════════════════════════════════
export const addAlert = (data) =>
  addItem(COLLECTIONS.ALERTS, {
    stationId:   data.stationId   || "",
    stationName: data.stationName || "",
    type:        data.type        || "تحذير",   // حرج | تحذير | معلومة
    message:     data.message     || "",
    severity:    data.severity    || "medium",  // high | medium | low
    resolved:    false,
  });

export const resolveAlert = (id) =>
  updateItem(COLLECTIONS.ALERTS, id, { resolved: true, resolvedAt: ts() });

export const deleteAlert = (id) =>
  deleteItem(COLLECTIONS.ALERTS, id);

// ══════════════════════════════════════════════════════════════════════
// 10. Fire Alerts
// ══════════════════════════════════════════════════════════════════════
export const addFireAlert = (data) =>
  addItem(COLLECTIONS.FIRE_ALERTS, {
    stationId:     data.stationId     || "",
    stationName:   data.stationName   || "",
    temperature:   Number(data.temperature) || 0,
    gasLevel:      Number(data.gasLevel)    || 0,
    smokeDetected: Boolean(data.smokeDetected),
    riskLevel:     data.riskLevel     || "آمن", // خطر عالي | خطر متوسط | تحذير | آمن
    resolved:      false,
  });

export const resolveFireAlert = (id) =>
  updateItem(COLLECTIONS.FIRE_ALERTS, id, { resolved: true, resolvedAt: ts() });

export const deleteFireAlert = (id) =>
  deleteItem(COLLECTIONS.FIRE_ALERTS, id);

// ══════════════════════════════════════════════════════════════════════
// 11. Reports (system-generated operational reports)
// ══════════════════════════════════════════════════════════════════════
export const addReport = (data) =>
  addItem(COLLECTIONS.REPORTS, {
    title:       data.title       || "",
    type:        data.type        || "أداء",
    period:      data.period      || "",
    generatedBy: data.generatedBy || "",
    summary:     data.summary     || "",
    data:        data.data        || {},
  });

export const deleteReport = (id) =>
  deleteItem(COLLECTIONS.REPORTS, id);

// ══════════════════════════════════════════════════════════════════════
// 12. Requests (citizen bin requests)
// ══════════════════════════════════════════════════════════════════════
export const addRequest = (data) =>
  addItem(COLLECTIONS.REQUESTS, {
    userId:    data.userId    || "",
    userName:  data.userName  || "",
    district:  data.district  || "",
    address:   data.address   || "",
    binType:   data.binType   || "مختلطة",
    notes:     data.notes     || "",
    stationId: data.stationId || "",
    status:    "قيد المراجعة",
  });

export const updateRequestStatus = (id, status, response = "") =>
  updateItem(COLLECTIONS.REQUESTS, id, { status, response });

export const deleteRequest = (id) =>
  deleteItem(COLLECTIONS.REQUESTS, id);

// ══════════════════════════════════════════════════════════════════════
// 13. Citizen Reports (complaints / citizen_reports)
// ══════════════════════════════════════════════════════════════════════
export const addCitizenReport = (data) =>
  addItem(COLLECTIONS.CITIZEN_REPORTS, {
    userId:      data.userId      || "",
    userName:    data.userName    || "",
    district:    data.district    || "",
    type:        data.type        || "",
    description: data.description || "",
    location:    data.location    || "",
    status:      "قيد المعالجة",
    response:    "",
  });

export const updateCitizenReport = (id, updates) =>
  updateItem(COLLECTIONS.CITIZEN_REPORTS, id, updates);

export const deleteCitizenReport = (id) =>
  deleteItem(COLLECTIONS.CITIZEN_REPORTS, id);

// ══════════════════════════════════════════════════════════════════════
// 14. Auto-generate alerts from stations  (call this when stations change)
// ══════════════════════════════════════════════════════════════════════
/**
 * Syncs alerts collection from stations data.
 * Adds a new alert ONLY if no unresolved alert already exists for that station.
 * Prevents duplicate alerts from accumulating over time.
 */
export const syncAlertsFromStations = async (stations = []) => {
  // Fetch all currently unresolved alerts once
  const snap = await getDocs(
    query(collection(db, COLLECTIONS.ALERTS), where("resolved", "==", false))
  );
  // Build a Set of stationIds that already have an open alert
  const openStationIds = new Set(snap.docs.map(d => d.data().stationId));

  for (const station of stations) {
    const st = getStatus(station.fillLevel);
    if ((st === "حرج" || st === "تحذير") && !openStationIds.has(station.id)) {
      await addAlert({
        stationId:   station.id,
        stationName: station.name,
        type:        st,
        message:     `${station.name} — مستوى الامتلاء ${station.fillLevel || 0}%`,
        severity:    st === "حرج" ? "high" : "medium",
      });
    }
  }
};

// ══════════════════════════════════════════════════════════════════════
// 15. Auto-sync districts performance from real stations data
//
// ⚠️ TECH DEBT (tracked, deliberate — do not "clean up" in isolation):
// This function + recordDailyStationHistory() below, and the two analytics
// docs they write (analytics/districts_perf, analytics/station_history),
// are NOT yet renamed/moved to the new bins/neighborhoods model. They were
// deliberately left reading "stations" grouped by station.district, because
// Phase 1 (smart-bin data-model introduction) does not wire bins into any
// page's live state yet — there is no live `bins` array to group here until
// a later phase cuts the UI over. Renaming this now would either require
// prematurely wiring bins into the app (out of scope) or produce a
// cosmetic-only rename that still groups by the old station.district field,
// which would need to be redone anyway once bins are live.
// MUST be closed out (grouped by bin.neighborhoodId, doc ids renamed to
// analytics/neighborhoods_perf + analytics/neighborhood_history, field key
// "المحطات" renamed to "الحاويات") once bins are wired into the app's live
// state — i.e. by the end of Phase 2/3 of the smart-bin redesign, not later.
// ══════════════════════════════════════════════════════════════════════
/**
 * Derives district performance metrics from live station data
 * and writes them to analytics/districts_perf.
 * Call this whenever stations change to keep the ExecDashboard chart live.
 */
export const syncDistrictsPerfFromStations = async (stations = []) => {
  if (stations.length === 0) return;

  // Group stations by district
  const byDistrict = {};
  for (const s of stations) {
    const d = s.district || "غير محدد";
    if (!byDistrict[d]) byDistrict[d] = [];
    byDistrict[d].push(s);
  }

  const data = Object.entries(byDistrict).map(([name, stList]) => {
    const avgFill   = Math.round(stList.reduce((a, s) => a + (s.fillLevel || 0), 0) / stList.length);
    const avgWaste  = Math.round(stList.reduce((a, s) => a + (s.dailyWaste || 0), 0) / stList.length);
    // Performance: higher when fill is low (stations are being serviced on time)
    const الأداء   = Math.max(10, 100 - Math.round(avgFill * 0.6));
    return {
      name:      name.replace("حي ", ""),
      الأداء,
      الامتلاء:  avgFill,
      الكمية:    avgWaste,
      المحطات:   stList.length,
    };
  });

  await setDoc(doc(db, "analytics", "districts_perf"), { data });
};

// ══════════════════════════════════════════════════════════════════════
// 16. Record daily station history snapshot
// ══════════════════════════════════════════════════════════════════════
const ARABIC_DAYS = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

/**
 * Appends today's readings for each station into analytics/station_history.
 * Keeps a rolling 7-day window per district.
 * Uses localStorage to ensure it only runs once per calendar day per browser.
 */
export const recordDailyStationHistory = async (stations = []) => {
  if (stations.length === 0) return;

  const todayKey = new Date().toISOString().slice(0, 10); // "2026-04-19"
  const storageKey = `station_history_recorded_${todayKey}`;
  if (localStorage.getItem(storageKey)) return; // already recorded today

  const ref  = doc(db, "analytics", "station_history");
  const snap = await getDoc(ref);
  const existing = snap.exists() ? (snap.data().data || {}) : {};

  const dayName = ARABIC_DAYS[new Date().getDay()];
  const updated = { ...existing };

  for (const s of stations) {
    const district = s.district || "غير محدد";
    const history  = Array.isArray(updated[district]) ? [...updated[district]] : [];
    // Add today's reading
    history.push({
      day:      dayName,
      الامتلاء: s.fillLevel   || 0,
      الضغط:    s.pressure    || 0,
      الكمية:   s.dailyWaste  || 0,
    });
    // Keep only the last 7 days
    updated[district] = history.slice(-7);
  }

  await setDoc(ref, { data: updated, updatedAt: new Date().toISOString() });
  localStorage.setItem(storageKey, "1");
  console.log(`[history] station_history recorded for ${todayKey}`);
};
