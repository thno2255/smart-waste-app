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
  getDoc, getDocs, setDoc, writeBatch, arrayUnion,
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
  STATIONS:        "stations",     // deprecated — still read live by a few out-of-scope legacy pages (see Phase 3 report)
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
  SUCTION_JOBS:    "suctionJobs", // deprecated — replaced by COLLECTION_ROUTES below
  // Phase 3 — decision support / route management
  VEHICLES:          "vehicles",
  COLLECTION_ROUTES: "collection_routes",
  ROUTE_BINS:        "route_bins",
  COLLECTION_EVENTS: "collection_events",
  AUDIT_LOG:         "audit_log",
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
  const [loading, setLoading] = useState(!!col); // a disabled hook (col=null) is never "loading"
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
    // value == null (not just falsy) — a legitimate filter value can be
    // `false`, `0`, or `""` (e.g. querying resolved:false alerts), and
    // treating those as "missing" would silently never query at all.
    if (!col || value == null) { setLoading(false); return; }

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

/**
 * Live subscription to all neighborhoods. Thin typed wrapper over
 * useCollection so every page that needs neighborhoods shares one
 * subscription pattern instead of each writing its own onSnapshot call.
 */
export function useNeighborhoods() {
  const { data, loading, error } = useCollection(COLLECTIONS.NEIGHBORHOODS, "name");
  return { neighborhoods: data, loading, error };
}

/**
 * Live subscription to all bins. Thin typed wrapper over useCollection —
 * reads the denormalized latest-reading fields on each bin doc directly,
 * never sensor_readings history (per the performance guidance: the
 * dashboard/map must only ever need the latest value per bin).
 */
export function useBins() {
  const { data, loading, error } = useCollection(COLLECTIONS.BINS, "name");
  return { bins: data, loading, error };
}

/**
 * Bounded per-bin reading history — ONLY for a single bin's detail view
 * (never for a list), and only the last `windowHours` worth, with a hard
 * limit, so predictions/fill-rate never load a bin's full history (§39).
 */
export function useBinReadings(binId, windowHours = THRESHOLDS.predictionWindowHours) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!binId) return; // nothing to fetch — loading/readings are computed below without a setState call here
    const cutoff = new Date(Date.now() - windowHours * 3600000).toISOString();
    // No composite index needed: filter client-side by timestamp after an
    // unordered equality query, same no-orderBy pattern as useCollectionWhere.
    const q = query(collection(db, COLLECTIONS.SENSOR_READINGS), where("bin_id", "==", binId));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const readings = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((r) => r.timestamp >= cutoff)
          .sort((a, b) => (a.timestamp > b.timestamp ? 1 : -1))
          .slice(-50); // hard cap regardless of window
        setData(readings);
        setLoading(false);
      },
      (err) => { console.error(`[useBinReadings:${binId}]`, err); setLoading(false); }
    );
    return () => unsub();
  }, [binId, windowHours]);

  return { readings: binId ? data : [], loading: binId ? loading : false };
}

/**
 * ALL sensor_readings within the last `windowHours` — ONE bounded,
 * time-windowed query for the whole fleet (not per-bin), used by views that
 * need every bin's recent trend at once (the map's future-state toggle,
 * §8). At demo/hackathon scale this is cheap; the ceiling to watch if the
 * fleet grows is this collection-wide scan itself, not N+1 per-bin reads.
 */
export function useRecentReadings(windowHours = THRESHOLDS.predictionWindowHours) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const cutoff = new Date(Date.now() - windowHours * 3600000).toISOString();
    const unsub = onSnapshot(
      collection(db, COLLECTIONS.SENSOR_READINGS),
      (snap) => {
        const readings = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((r) => r.timestamp >= cutoff);
        setData(readings);
        setLoading(false);
      },
      (err) => { console.error("[useRecentReadings]", err); setLoading(false); }
    );
    return () => unsub();
  }, [windowHours]);

  return { readings: data, loading };
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

// ══════════════════════════════════════════════════════════════════════
// 17. Vehicles — §19
// ══════════════════════════════════════════════════════════════════════
export function useVehicles() {
  const { data, loading, error } = useCollection(COLLECTIONS.VEHICLES, "vehicleNumber");
  return { vehicles: data, loading, error };
}

export const addVehicle = (data) =>
  addItem(COLLECTIONS.VEHICLES, {
    vehicleNumber:  data.vehicleNumber  || "",
    driverName:     data.driverName     || null,
    status:         data.status         || "available", // available | on_route | maintenance | offline
    capacityLiters: Number(data.capacityLiters) || 6000,
    depotLat:       data.depotLat ?? null, // where the vehicle starts its day — the driver portal's fallback position when GPS is unavailable
    depotLng:       data.depotLng ?? null,
    currentRouteId: null,
    lastActiveAt:   null,
  });

export const updateVehicleStatus = (id, status, currentRouteId = null) =>
  updateItem(COLLECTIONS.VEHICLES, id, { status, currentRouteId, lastActiveAt: ts() });

export const deleteVehicle = (id) => deleteItem(COLLECTIONS.VEHICLES, id);

// ══════════════════════════════════════════════════════════════════════
// 18. Collection routes + route bins — §15/§17/§18
//    status lifecycle: suggested → approved → in_progress → completed
//                                 ↘ rejected / deferred
//    The engine (src/decisionEngine.js) only ever proposes "suggested" —
//    every later transition requires an explicit employee/driver action
//    from the UI, never a side effect of a snapshot listener.
// ══════════════════════════════════════════════════════════════════════
/** All routes — staff only. Pass enabled=false for driver accounts (rules deny the unscoped list; drivers use useMyRoutes). */
export function useCollectionRoutes(enabled = true) {
  const { data, loading, error } = useCollection(enabled ? COLLECTIONS.COLLECTION_ROUTES : null);
  return { routes: data, loading: enabled ? loading : false, error };
}

/** Persists engine-recommended routes as "suggested" — skips any route whose binIds set already matches an existing open (non-completed/rejected) suggestion, so re-running the engine doesn't spam duplicates. */
export const createSuggestedRoutes = async (recommended = []) => {
  const openSnap = await getDocs(
    query(collection(db, COLLECTIONS.COLLECTION_ROUTES), where("status", "in", ["suggested", "approved", "in_progress"]))
  );
  const openBinSets = openSnap.docs.map((d) => new Set(d.data().binIds || []));
  const sameSet = (a, b) => a.size === b.length && b.every((id) => a.has(id));

  let created = 0;
  for (const route of recommended) {
    if (openBinSets.some((set) => sameSet(set, route.binIds))) continue;
    await addItem(COLLECTIONS.COLLECTION_ROUTES, { ...route, approvedBy: null, approvedAt: null, startedAt: null, completedAt: null, vehicleId: null });
    created += 1;
  }
  return created;
};

/**
 * Applies a decisionEngine.reconcileRecommendations() result: new suggestions
 * are created, existing suggestions are refreshed in place (no duplicates per
 * neighborhood), and suggestions whose bins no longer qualify are marked
 * "withdrawn" — kept in the history, never silently deleted. Approved and
 * in-progress routes are never part of the input, so they are never touched.
 */
export const applyRouteReconciliation = async ({ toCreate = [], toUpdate = [], toWithdraw = [] }, meta = {}) => {
  for (const route of toCreate) {
    await addItem(COLLECTIONS.COLLECTION_ROUTES, { ...route, manualBinIds: [], approvedBy: null, approvedAt: null, startedAt: null, completedAt: null, vehicleId: null, ...meta });
  }
  for (const { id, data } of toUpdate) {
    await updateItem(COLLECTIONS.COLLECTION_ROUTES, id, data);
  }
  for (const id of toWithdraw) {
    await updateItem(COLLECTIONS.COLLECTION_ROUTES, id, { status: "withdrawn", withdrawnAt: ts(), withdrawReason: "لم تعد هناك حاويات مؤهلة للجمع في هذا الحي — سُحب الاقتراح تلقائيًا" });
  }
  return { created: toCreate.length, updated: toUpdate.length, withdrawn: toWithdraw.length };
};

export const updateRoute = (id, data) => updateItem(COLLECTIONS.COLLECTION_ROUTES, id, data);

export const approveRoute = (id, uid, vehicleId) =>
  updateItem(COLLECTIONS.COLLECTION_ROUTES, id, { status: "approved", approvedBy: uid, approvedAt: ts(), vehicleId });

export const rejectRoute = (id, uid, reason = "") =>
  updateItem(COLLECTIONS.COLLECTION_ROUTES, id, { status: "rejected", rejectedBy: uid, rejectedAt: ts(), rejectReason: reason });

export const deferRoute = (id, uid) =>
  updateItem(COLLECTIONS.COLLECTION_ROUTES, id, { status: "deferred", deferredBy: uid, deferredAt: ts() });

export const startRoute = async (id, vehicleId) => {
  await updateItem(COLLECTIONS.COLLECTION_ROUTES, id, { status: "in_progress", startedAt: ts() });
  if (vehicleId) await updateVehicleStatus(vehicleId, "on_route", id);
};

export const completeRoute = async (id, vehicleId) => {
  await updateItem(COLLECTIONS.COLLECTION_ROUTES, id, { status: "completed", completedAt: ts() });
  if (vehicleId) await updateVehicleStatus(vehicleId, "available", null);
};

export const deleteRoute = (id) => deleteItem(COLLECTIONS.COLLECTION_ROUTES, id);

// ══════════════════════════════════════════════════════════════════════
// 19. Collection events — §26/§27
// ══════════════════════════════════════════════════════════════════════
export function useCollectionEvents() {
  const { data, loading, error } = useCollection(COLLECTIONS.COLLECTION_EVENTS);
  return { events: data, loading, error };
}

/**
 * Records a collection event AND updates bin.lastCollectionAt — does NOT
 * touch sensor_readings (§27: history is never rewritten/deleted). If no
 * fresh reading has arrived since, the bin's lastFillLevelPercent stays
 * as the last pre-collection value — the UI is responsible for labeling
 * it "قبل التفريغ" rather than implying it's a fresh live reading.
 */
export const recordCollectionEvent = async (binId, routeId, vehicleId, operatorId, fillBefore) => {
  const batch = writeBatch(db);
  const eventRef = doc(collection(db, COLLECTIONS.COLLECTION_EVENTS));
  batch.set(eventRef, {
    binId, routeId, vehicleId, operatorId,
    fillBefore: Number(fillBefore) || 0,
    fillAfter: 0,
    source: "route",
    collectedAt: ts(),
    createdAt: ts(),
  });
  batch.update(doc(db, COLLECTIONS.BINS, binId), { lastCollectionAt: ts() });
  await batch.commit();
  return eventRef.id;
};

// ══════════════════════════════════════════════════════════════════════
// 20. Audit log — §37
// ══════════════════════════════════════════════════════════════════════
export function useAuditLog(enabled = true) {
  const { data, loading, error } = useCollection(enabled ? COLLECTIONS.AUDIT_LOG : null);
  return { auditLog: data, loading, error };
}

export const writeAuditLog = (action, actorId, actorName, details = {}) =>
  addItem(COLLECTIONS.AUDIT_LOG, { action, actorId: actorId || "", actorName: actorName || "", details });

// ══════════════════════════════════════════════════════════════════════
// 21. Alerts sync from Decision Engine candidates — §28/§29
//    Mirrors the existing syncAlertsFromStations() dedup pattern above,
//    but keyed by the engine's dedupKey instead of stationId, and covers
//    every Phase 3 alert type (bin/neighborhood/route/vehicle), not just
//    station fill-level.
// ══════════════════════════════════════════════════════════════════════
export const syncAlertsFromCandidates = async (candidates = []) => {
  if (candidates.length === 0) return { created: 0 };

  const openSnap = await getDocs(
    query(collection(db, COLLECTIONS.ALERTS), where("resolved", "==", false))
  );
  const openDedupKeys = new Set(openSnap.docs.map((d) => d.data().dedupKey).filter(Boolean));

  let created = 0;
  for (const c of candidates) {
    if (openDedupKeys.has(c.dedupKey)) continue;
    await addItem(COLLECTIONS.ALERTS, {
      type: c.type, severity: c.severity, sourceId: c.sourceId, sourceName: c.sourceName,
      message: c.message, dedupKey: c.dedupKey, resolved: false,
    });
    openDedupKeys.add(c.dedupKey); // guard against duplicate candidates within this same call
    created += 1;
  }
  return { created };
};

// ══════════════════════════════════════════════════════════════════════
// 22. Demo Mode actions — §32/§33
//    Every write here is explicitly tagged demo:true / source:"demo" so it
//    is never mistaken for a real device reading (§33's Live-vs-Demo rule).
//    Unlike recordSensorReading(), demoSetFault() deliberately writes an
//    out-of-range value — recordSensorReading's validation exists to reject
//    exactly that from a real device; here it's the intended simulated state.
// ══════════════════════════════════════════════════════════════════════
const HOUR_MS_FS = 60 * 60 * 1000;

export const demoSetReading = async (binId, fillLevelPercent, temperatureCelsius) => {
  const timestamp = ts();
  const batch = writeBatch(db);
  const readingRef = doc(collection(db, COLLECTIONS.SENSOR_READINGS));
  batch.set(readingRef, {
    bin_id: binId, device_id: "DEMO", fill_level_percent: Number(fillLevelPercent), temperature_celsius: Number(temperatureCelsius),
    battery_level: null, signal: null, timestamp, receivedAt: timestamp, demo: true, source: "demo",
  });
  batch.update(doc(db, COLLECTIONS.BINS, binId), {
    lastFillLevelPercent: Number(fillLevelPercent), lastTemperatureCelsius: Number(temperatureCelsius), lastReadingAt: timestamp,
  });
  await batch.commit();
};

export const demoSetOffline = (binId) =>
  updateItem(COLLECTIONS.BINS, binId, { lastReadingAt: new Date(Date.now() - 2 * HOUR_MS_FS).toISOString() });

export const demoSetFault = async (binId) => {
  const timestamp = ts();
  const batch = writeBatch(db);
  const readingRef = doc(collection(db, COLLECTIONS.SENSOR_READINGS));
  batch.set(readingRef, {
    bin_id: binId, device_id: "DEMO", fill_level_percent: 240, temperature_celsius: 25,
    battery_level: null, signal: null, timestamp, receivedAt: timestamp, demo: true, source: "demo",
  });
  batch.update(doc(db, COLLECTIONS.BINS, binId), { lastFillLevelPercent: 240, lastTemperatureCelsius: 25, lastReadingAt: timestamp });
  await batch.commit();
};

export const demoReset = (binId) => demoSetReading(binId, 20, 25);

// ══════════════════════════════════════════════════════════════════════
// 23. IoT device registry + per-device keys
//    The plain key is generated in the browser, shown ONCE to the employee,
//    and only its SHA-256 hash is stored — the server ingest route
//    (/api/iot/readings) compares hashes. The demo seed's placeholder key is
//    explicitly rejected by that route.
// ══════════════════════════════════════════════════════════════════════
export function useIotDevices() {
  const { data, loading, error } = useCollection(COLLECTIONS.IOT_DEVICES, "label");
  return { devices: data, loading, error };
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Generates a new 32-byte key for a device, stores only its hash, and returns the plain key for one-time display. */
export const rotateDeviceKey = async (deviceDocId) => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const plainKey = "swm_" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  const deviceKeyHash = await sha256Hex(plainKey);
  await updateItem(COLLECTIONS.IOT_DEVICES, deviceDocId, { deviceKeyHash, deviceKey: null, keyRotatedAt: ts() });
  return plainKey;
};

export const setDeviceDisabled = (deviceDocId, disabled) =>
  updateItem(COLLECTIONS.IOT_DEVICES, deviceDocId, { disabled: !!disabled });

// ══════════════════════════════════════════════════════════════════════
// 24. Fleet platform — Phase 1: driver profiles, vehicle assignments,
//     shifts, and driver-scoped route reads. Rules in src/fleetEngine.js;
//     enforcement mirrored in firestore.rules (deploy explicitly).
// ══════════════════════════════════════════════════════════════════════
COLLECTIONS.DRIVER_PROFILES = "driver_profiles";                 // one doc per driver, id = auth uid
COLLECTIONS.DRIVER_VEHICLE_ASSIGNMENTS = "driver_vehicle_assignments"; // time-windowed history, never deleted
COLLECTIONS.DRIVER_ASSIGNMENT_HISTORY = "driver_assignment_history";  // coverage/vehicle/shift changes with before/after
COLLECTIONS.DRIVER_SHIFTS = "driver_shifts";                     // clock-in / clock-out records

export function useDriverProfiles(enabled = true) {
  const { data, loading, error } = useCollection(enabled ? COLLECTIONS.DRIVER_PROFILES : null, "fullName");
  return { profiles: data, loading, error };
}
export function useDriverVehicleAssignments(enabled = true) {
  const { data, loading, error } = useCollection(enabled ? COLLECTIONS.DRIVER_VEHICLE_ASSIGNMENTS : null, "start");
  return { assignments: data, loading, error };
}
export function useDriverAssignmentHistory(driverId) {
  return useCollectionWhere(COLLECTIONS.DRIVER_ASSIGNMENT_HISTORY, "driverId", driverId || null);
}
/** A driver's own profile (live). */
export function useMyDriverProfile(uid) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(!!uid);
  useEffect(() => {
    if (!uid) return;
    const unsub = onSnapshot(doc(db, COLLECTIONS.DRIVER_PROFILES, uid), (snap) => { setProfile(snap.exists() ? { id: snap.id, ...snap.data() } : null); setLoading(false); }, () => setLoading(false));
    return () => unsub();
  }, [uid]);
  return { profile, loading };
}
/** Routes assigned to THIS driver only (driverId == uid) — the only route query a driver account is allowed to run. */
export function useMyRoutes(uid) {
  return useCollectionWhere(COLLECTIONS.COLLECTION_ROUTES, "driverId", uid || null);
}

/** Creates/refreshes the profile shell for a users/{uid} doc with role=driver. Idempotent. */
export const ensureDriverProfile = async (userDoc) => {
  const ref = doc(db, COLLECTIONS.DRIVER_PROFILES, userDoc.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return snap.data();
  const data = {
    uid: userDoc.uid, driverCode: null, fullName: userDoc.fullName || "", phone: userDoc.phone || "", email: userDoc.email || "",
    accountStatus: userDoc.status || "pending", shiftStatus: "off_shift", availability: "available",
    vehicleId: null, neighborhoodKeys: [], shiftStart: null, shiftEnd: null,
    locationSharing: false, lastLocation: null, currentRouteId: null,
    stats: { routesCompleted: 0, binsCollected: 0 },
    createdAt: ts(), updatedAt: ts(),
  };
  await setDoc(ref, data);
  return data;
};

/** Admin update of profile fields + history row + audit. `patch` is already validated by fleetEngine.validateDriverProfile. */
export const updateDriverProfile = async (driverId, patch, before, actor, reason = "") => {
  const changed = Object.keys(patch).filter((k) => JSON.stringify(patch[k]) !== JSON.stringify(before?.[k]));
  const batch = writeBatch(db);
  batch.set(doc(db, COLLECTIONS.DRIVER_PROFILES, driverId), { ...patch, updatedAt: ts() }, { merge: true });
  if (changed.length) {
    batch.set(doc(collection(db, COLLECTIONS.DRIVER_ASSIGNMENT_HISTORY)), {
      driverId, fields: changed, before: Object.fromEntries(changed.map((k) => [k, before?.[k] ?? null])), after: Object.fromEntries(changed.map((k) => [k, patch[k] ?? null])),
      actorId: actor?.uid || "", actorName: actor?.name || "", reason, createdAt: ts(),
    });
    batch.set(doc(collection(db, COLLECTIONS.AUDIT_LOG)), { action: "driver_profile_updated", actorId: actor?.uid || "", actorName: actor?.name || "", details: { driverId, fields: changed, reason }, createdAt: ts() });
  }
  await batch.commit();
};

/** Time-windowed vehicle assignment. Caller MUST have run fleetEngine.findVehicleAssignmentConflicts first; this re-checks nothing. */
export const assignVehicleToDriver = async ({ driverId, driverName, vehicleId, vehicleNumber, start, end = null }, actor, reason = "") => {
  const batch = writeBatch(db);
  const ref = doc(collection(db, COLLECTIONS.DRIVER_VEHICLE_ASSIGNMENTS));
  batch.set(ref, { driverId, driverName: driverName || "", vehicleId, vehicleNumber: vehicleNumber || "", start, end, active: true, assignedBy: actor?.uid || "", assignedByName: actor?.name || "", reason, createdAt: ts() });
  batch.set(doc(db, COLLECTIONS.DRIVER_PROFILES, driverId), { vehicleId, updatedAt: ts() }, { merge: true });
  if ((await getDoc(doc(db, COLLECTIONS.VEHICLES, vehicleId))).exists()) batch.update(doc(db, COLLECTIONS.VEHICLES, vehicleId), { driverId, driverName: driverName || null });
  batch.set(doc(collection(db, COLLECTIONS.AUDIT_LOG)), { action: "driver_vehicle_assigned", actorId: actor?.uid || "", actorName: actor?.name || "", details: { driverId, vehicleId, start, end, reason }, createdAt: ts() });
  await batch.commit();
  return ref.id;
};
export const endVehicleAssignment = async (assignment, actor, reason = "") => {
  const batch = writeBatch(db);
  batch.update(doc(db, COLLECTIONS.DRIVER_VEHICLE_ASSIGNMENTS, assignment.id), { active: false, end: ts(), endedBy: actor?.uid || "", endReason: reason });
  batch.set(doc(db, COLLECTIONS.DRIVER_PROFILES, assignment.driverId), { vehicleId: null, updatedAt: ts() }, { merge: true });
  // The vehicle may have been deleted since the assignment was made — closing the assignment must still succeed.
  if ((await getDoc(doc(db, COLLECTIONS.VEHICLES, assignment.vehicleId))).exists()) batch.update(doc(db, COLLECTIONS.VEHICLES, assignment.vehicleId), { driverId: null, driverName: null });
  batch.set(doc(collection(db, COLLECTIONS.AUDIT_LOG)), { action: "driver_vehicle_unassigned", actorId: actor?.uid || "", actorName: actor?.name || "", details: { driverId: assignment.driverId, vehicleId: assignment.vehicleId, reason }, createdAt: ts() });
  await batch.commit();
};

/** Driver clock-in / clock-out (own profile only — enforced by rules). Location sharing is ON only while on shift. */
export const setDriverShift = async (uid, shiftStatus, actorName = "") => {
  const batch = writeBatch(db);
  const patch = { shiftStatus, updatedAt: ts() };
  if (shiftStatus === "on_shift") { patch.locationSharing = true; patch.availability = "available"; }
  if (shiftStatus === "off_shift") { patch.locationSharing = false; patch.lastLocation = null; patch.availability = "unavailable"; } // location retention: wiped at clock-out
  batch.set(doc(db, COLLECTIONS.DRIVER_PROFILES, uid), patch, { merge: true });
  batch.set(doc(collection(db, COLLECTIONS.DRIVER_SHIFTS)), { driverId: uid, status: shiftStatus, at: ts(), createdAt: ts() });
  batch.set(doc(collection(db, COLLECTIONS.AUDIT_LOG)), { action: shiftStatus === "on_shift" ? "driver_clocked_in" : shiftStatus === "off_shift" ? "driver_clocked_out" : "driver_break", actorId: uid, actorName, details: {}, createdAt: ts() });
  await batch.commit();
};
export const setDriverAvailability = (uid, availability) =>
  setDoc(doc(db, COLLECTIONS.DRIVER_PROFILES, uid), { availability, updatedAt: ts() }, { merge: true });

/** Approve + assign in one write: the route carries driverId/vehicleId so the driver's scoped query sees it. */
export const approveAndAssignRoute = (id, uid, { driverId, driverName, vehicleId }, exceptional = null) =>
  updateItem(COLLECTIONS.COLLECTION_ROUTES, id, {
    status: "approved", approvedBy: uid, approvedAt: ts(), vehicleId, driverId, driverName: driverName || null,
    assignmentException: exceptional ? { reason: exceptional.reason, by: uid, at: ts() } : null,
  });

// ══════════════════════════════════════════════════════════════════════
// 25. Fleet platform — Phases 4/5: field execution, incidents, live locations.
// ══════════════════════════════════════════════════════════════════════
COLLECTIONS.ROUTE_INCIDENTS = "route_incidents";
COLLECTIONS.DRIVER_LOCATIONS = "driver_locations";
COLLECTIONS.VEHICLE_STATUS_HISTORY = "vehicle_status_history";

export function useRouteIncidents(enabled = true) {
  const { data, loading, error } = useCollection(enabled ? COLLECTIONS.ROUTE_INCIDENTS : null);
  return { incidents: data, loading, error };
}

/**
 * Idempotent collection confirmation: the event doc id is routeId__binId, so a
 * repeated tap (or an offline replay) overwrites the same doc instead of
 * creating a second event. Updates ONLY operational fields on the bin
 * (lastCollectionAt) — the measured fill level is never touched here.
 */
export const confirmCollection = async (confirmation) => {
  const batch = writeBatch(db);
  batch.set(doc(db, COLLECTIONS.COLLECTION_EVENTS, confirmation.id), { ...confirmation, collectedAt: confirmation.confirmedAt, createdAt: ts() }, { merge: true });
  batch.update(doc(db, COLLECTIONS.COLLECTION_ROUTES, confirmation.routeId), { collectedBinIds: arrayUnion(confirmation.binId), lastProgressAt: ts() });
  batch.update(doc(db, COLLECTIONS.BINS, confirmation.binId), { lastCollectionAt: confirmation.confirmedAt });
  await batch.commit();
  return confirmation.id;
};

/** Driver reports an obstacle/fault/unreachable stop: incident doc + the stop moves to skippedStops (never to collected). */
export const reportRouteIncident = async ({ route, binId = null, type, note = "", user, position }) => {
  const incRef = doc(collection(db, COLLECTIONS.ROUTE_INCIDENTS));
  const batch = writeBatch(db);
  batch.set(incRef, {
    routeId: route.id, routeName: route.routeName || "", binId, driverId: user.uid, driverName: user.name || "", vehicleId: route.vehicleId || null,
    type, note, status: "open", reviewedBy: null, reviewedAt: null, resolution: "",
    location: position?.lat != null ? { lat: position.lat, lng: position.lng, accuracyM: position.accuracy ?? null } : null,
    createdAt: ts(),
  });
  if (binId) batch.update(doc(db, COLLECTIONS.COLLECTION_ROUTES, route.id), { skippedStops: arrayUnion({ binId, reason: type, incidentId: incRef.id, note, at: ts() }), lastProgressAt: ts() });
  batch.set(doc(collection(db, COLLECTIONS.AUDIT_LOG)), { action: `route_${type === "fault" ? "fault" : type === "obstacle" ? "obstacle" : "unreachable"}_reported`, actorId: user.uid, actorName: user.name || "", details: { routeId: route.id, routeName: route.routeName, binId, incidentId: incRef.id, note }, createdAt: ts() });
  await batch.commit();
  return incRef.id;
};
export const reviewRouteIncident = (id, uid, status, resolution = "") =>
  updateItem(COLLECTIONS.ROUTE_INCIDENTS, id, { status, reviewedBy: uid, reviewedAt: ts(), resolution });
/** Put a skipped stop back in the queue (admin or driver re-attempt). */
export const reinstateRouteStop = (routeId, skippedStops) => updateItem(COLLECTIONS.COLLECTION_ROUTES, routeId, { skippedStops });

/**
 * Live location while ON SHIFT only: profile.lastLocation (latest, for the fleet
 * map) + an append-only ping in driver_locations (route replay). Retention: the
 * profile copy is wiped at clock-out; pings carry `expiresAt` (7 days) for a
 * scheduled cleanup/TTL policy.
 */
export const persistDriverLocation = async (uid, loc, routeId = null) => {
  const at = loc.at || new Date().toISOString();
  const batch = writeBatch(db);
  batch.set(doc(db, COLLECTIONS.DRIVER_PROFILES, uid), { lastLocation: { lat: loc.lat, lng: loc.lng, accuracyM: loc.accuracy ?? null, heading: loc.heading ?? null, speedMps: loc.speed ?? null, at }, updatedAt: ts() }, { merge: true });
  batch.set(doc(collection(db, COLLECTIONS.DRIVER_LOCATIONS)), { driverId: uid, routeId, lat: loc.lat, lng: loc.lng, accuracyM: loc.accuracy ?? null, heading: loc.heading ?? null, speedMps: loc.speed ?? null, at, expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(), createdAt: ts() });
  await batch.commit();
};

/** Vehicle status changes are kept as history (who/when/why). */
export const setVehicleStatusWithHistory = async (vehicleId, from, to, actor, reason = "", currentRouteId = null) => {
  const batch = writeBatch(db);
  batch.update(doc(db, COLLECTIONS.VEHICLES, vehicleId), { status: to, currentRouteId, lastActiveAt: ts() });
  batch.set(doc(collection(db, COLLECTIONS.VEHICLE_STATUS_HISTORY)), { vehicleId, from, to, actorId: actor?.uid || "", actorName: actor?.name || "", reason, createdAt: ts() });
  await batch.commit();
};
