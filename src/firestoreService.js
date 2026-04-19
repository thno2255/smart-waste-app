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
  getDoc,
} from "firebase/firestore";
import { db } from "./firebase";

// ══════════════════════════════════════════════════════════════════════
// 1. Collection Names
// ══════════════════════════════════════════════════════════════════════
export const COLLECTIONS = {
  STATIONS:        "stations",
  DISTRICTS:       "districts",
  CONTAINERS:      "containers",
  SENSORS:         "sensors",
  ALERTS:          "alerts",
  FIRE_ALERTS:     "fire_alerts",
  REPORTS:         "reports",
  REQUESTS:        "requests",
  CITIZEN_REPORTS: "citizen_reports",
  USERS:           "users",
  SUCTION_JOBS:    "suctionJobs",
};

// ══════════════════════════════════════════════════════════════════════
// 2. Status Logic  (single source of truth — never store status in DB)
// ══════════════════════════════════════════════════════════════════════
export const getStatus = (fillLevel) => {
  const v = Number(fillLevel) || 0;
  if (v >= 85) return "حرج";
  if (v >= 60) return "تحذير";
  return "طبيعي";
};

export const getStatusColor = (fillLevel) => {
  const v = Number(fillLevel) || 0;
  if (v >= 85) return "#ef4444";
  if (v >= 60) return "#f59e0b";
  return "#10b981";
};

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
// 6. Containers  (standalone collection — also lives inside station doc)
// ══════════════════════════════════════════════════════════════════════
/**
 * Standalone container document (for sensor linking etc.)
 * stationId links back to the parent station.
 */
export const addContainer = (data) =>
  addItem(COLLECTIONS.CONTAINERS, {
    name:      data.name      || "",
    fillLevel: Number(data.fillLevel) || 0,
    stationId: data.stationId || "",
    district:  data.district  || "",
  });

export const updateContainer = (id, data) =>
  updateItem(COLLECTIONS.CONTAINERS, id, {
    name:      data.name,
    fillLevel: Number(data.fillLevel) || 0,
  });

export const deleteContainer = (id) =>
  deleteItem(COLLECTIONS.CONTAINERS, id);

// ══════════════════════════════════════════════════════════════════════
// 7. Districts
// ══════════════════════════════════════════════════════════════════════
export const addDistrict = (data) =>
  addItem(COLLECTIONS.DISTRICTS, {
    name:        data.name        || "",
    city:        data.city        || "بريدة",
    fillLevel:   Number(data.fillLevel)   || 0,
    wasteTotal:  Number(data.wasteTotal)  || 0,
    performance: Number(data.performance) || 0,
    stationCount: Number(data.stationCount) || 0,
  });

export const updateDistrict = (id, data) =>
  updateItem(COLLECTIONS.DISTRICTS, id, data);

export const deleteDistrict = (id) =>
  deleteItem(COLLECTIONS.DISTRICTS, id);

// ══════════════════════════════════════════════════════════════════════
// 8. Sensors
// ══════════════════════════════════════════════════════════════════════
export const addSensor = (data) =>
  addItem(COLLECTIONS.SENSORS, {
    containerId:  data.containerId  || "",
    stationId:    data.stationId    || "",
    type:         data.type         || "fill_level", // fill_level | temperature | gas | humidity
    value:        Number(data.value) || 0,
    unit:         data.unit         || "%",
    lastReading:  ts(),
  });

export const updateSensorReading = (id, value) =>
  updateItem(COLLECTIONS.SENSORS, id, { value: Number(value) || 0, lastReading: ts() });

export const deleteSensor = (id) =>
  deleteItem(COLLECTIONS.SENSORS, id);

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
 * Adds new unresolved alerts for critical/warning stations.
 * Does NOT duplicate — caller should check existing alerts first.
 */
export const syncAlertsFromStations = async (stations = []) => {
  for (const station of stations) {
    const st = getStatus(station.fillLevel);
    if (st === "حرج" || st === "تحذير") {
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
