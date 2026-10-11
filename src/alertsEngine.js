/**
 * alertsEngine.js
 * ─────────────────────────────────────────────────────────────────────
 * Pure candidate-generation for the alert types in Phase 3 §28. This
 * module never touches Firestore — it scans already-scored bins/
 * neighborhoods and returns CANDIDATE alerts with a stable `dedupKey`.
 * firestoreService.js's syncAlertsFromCandidates() is what actually
 * checks for an existing open alert with the same key before writing,
 * so refreshing the dashboard never spawns duplicate alerts (§29).
 * ─────────────────────────────────────────────────────────────────────
 */

import { THRESHOLDS } from "./config";

export const ALERT_TYPES = {
  BIN_CRITICAL: "bin_critical",
  PREDICTED_FULL_SOON: "predicted_full_soon",
  TEMPERATURE_CRITICAL: "temperature_critical",
  SENSOR_OFFLINE: "sensor_offline",
  SENSOR_FAULT: "sensor_fault",
  NEIGHBORHOOD_CRITICAL: "neighborhood_critical",
  ROUTE_BLOCKED: "route_blocked",
  VEHICLE_ISSUE: "vehicle_issue",
};

export const ALERT_TYPE_LABELS = {
  [ALERT_TYPES.BIN_CRITICAL]: "حاوية حرجة",
  [ALERT_TYPES.PREDICTED_FULL_SOON]: "امتلاء متوقع قريبًا",
  [ALERT_TYPES.TEMPERATURE_CRITICAL]: "حرارة مرتفعة",
  [ALERT_TYPES.SENSOR_OFFLINE]: "مستشعر غير متصل",
  [ALERT_TYPES.SENSOR_FAULT]: "خلل بمستشعر",
  [ALERT_TYPES.NEIGHBORHOOD_CRITICAL]: "حي بحالة حرجة",
  [ALERT_TYPES.ROUTE_BLOCKED]: "جولة تحتاج مراجعة",
  [ALERT_TYPES.VEHICLE_ISSUE]: "مشكلة بمركبة",
};

export const ALERT_TYPE_ICONS = {
  [ALERT_TYPES.BIN_CRITICAL]: "🗑️",
  [ALERT_TYPES.PREDICTED_FULL_SOON]: "⏳",
  [ALERT_TYPES.TEMPERATURE_CRITICAL]: "🌡️",
  [ALERT_TYPES.SENSOR_OFFLINE]: "📡",
  [ALERT_TYPES.SENSOR_FAULT]: "⚠️",
  [ALERT_TYPES.NEIGHBORHOOD_CRITICAL]: "🏘️",
  [ALERT_TYPES.ROUTE_BLOCKED]: "🧭",
  [ALERT_TYPES.VEHICLE_ISSUE]: "🚛",
};

const SEVERITY = {
  [ALERT_TYPES.BIN_CRITICAL]: "high",
  [ALERT_TYPES.PREDICTED_FULL_SOON]: "medium",
  [ALERT_TYPES.TEMPERATURE_CRITICAL]: "high",
  [ALERT_TYPES.SENSOR_OFFLINE]: "low",
  [ALERT_TYPES.SENSOR_FAULT]: "medium",
  [ALERT_TYPES.NEIGHBORHOOD_CRITICAL]: "high",
  [ALERT_TYPES.ROUTE_BLOCKED]: "medium",
  [ALERT_TYPES.VEHICLE_ISSUE]: "medium",
};

/**
 * @param {Array<{bin:object, priority:object}>} scoredBins
 * @param {Array<{neighborhood:object, priority:object}>} scoredNeighborhoods
 * @returns {Array<object>} candidate alerts — {type, severity, sourceId, message, dedupKey}
 */
export function generateAlertCandidates(scoredBins = [], scoredNeighborhoods = []) {
  const candidates = [];

  for (const { bin, priority } of scoredBins) {
    if (priority.tier === "critical" && Number(bin.lastFillLevelPercent) >= THRESHOLDS.fillCriticalPct) {
      candidates.push({
        type: ALERT_TYPES.BIN_CRITICAL, severity: SEVERITY[ALERT_TYPES.BIN_CRITICAL],
        sourceId: bin.id, sourceName: bin.name,
        message: `${bin.name} — نسبة الامتلاء ${bin.lastFillLevelPercent}%`,
        dedupKey: `${ALERT_TYPES.BIN_CRITICAL}:${bin.id}`,
      });
    }

    if (priority.prediction?.predictionAvailable && priority.prediction.hoursToFull <= THRESHOLDS.predictedFullSoonHours) {
      candidates.push({
        type: ALERT_TYPES.PREDICTED_FULL_SOON, severity: SEVERITY[ALERT_TYPES.PREDICTED_FULL_SOON],
        sourceId: bin.id, sourceName: bin.name,
        message: `${bin.name} — متوقع الامتلاء خلال ${priority.prediction.hoursToFull.toFixed(1)} ساعة`,
        dedupKey: `${ALERT_TYPES.PREDICTED_FULL_SOON}:${bin.id}`,
      });
    }

    const temp = bin.lastTemperatureCelsius;
    if (temp != null && Number(temp) >= THRESHOLDS.tempCriticalC) {
      candidates.push({
        type: ALERT_TYPES.TEMPERATURE_CRITICAL, severity: SEVERITY[ALERT_TYPES.TEMPERATURE_CRITICAL],
        sourceId: bin.id, sourceName: bin.name,
        message: `${bin.name} — درجة حرارة مرتفعة ${Number(temp).toFixed(0)}°م`,
        dedupKey: `${ALERT_TYPES.TEMPERATURE_CRITICAL}:${bin.id}`,
      });
    }

    if (priority.sensorHealth?.status === "fault") {
      candidates.push({
        type: ALERT_TYPES.SENSOR_FAULT, severity: SEVERITY[ALERT_TYPES.SENSOR_FAULT],
        sourceId: bin.id, sourceName: bin.name,
        message: `${bin.name} — قراءة مستشعر غير موثوقة`,
        dedupKey: `${ALERT_TYPES.SENSOR_FAULT}:${bin.id}`,
      });
    } else if (priority.sensorHealth?.connectivity === "offline") {
      candidates.push({
        type: ALERT_TYPES.SENSOR_OFFLINE, severity: SEVERITY[ALERT_TYPES.SENSOR_OFFLINE],
        sourceId: bin.id, sourceName: bin.name,
        message: `${bin.name} — المستشعر غير متصل`,
        dedupKey: `${ALERT_TYPES.SENSOR_OFFLINE}:${bin.id}`,
      });
    }
  }

  for (const { neighborhood, priority } of scoredNeighborhoods) {
    if (priority.tier === "critical") {
      candidates.push({
        type: ALERT_TYPES.NEIGHBORHOOD_CRITICAL, severity: SEVERITY[ALERT_TYPES.NEIGHBORHOOD_CRITICAL],
        sourceId: neighborhood.id, sourceName: neighborhood.name,
        message: `${neighborhood.name} — حالة حرجة (${priority.criticalCount} حاوية حرجة من أصل ${priority.total})`,
        dedupKey: `${ALERT_TYPES.NEIGHBORHOOD_CRITICAL}:${neighborhood.id}`,
      });
    }
  }

  return candidates;
}

/** Event-driven alert for a route that failed its pre-check — called at the point of failure, not scanned continuously. */
export function buildRouteBlockedAlert(route, issues) {
  return {
    type: ALERT_TYPES.ROUTE_BLOCKED, severity: SEVERITY[ALERT_TYPES.ROUTE_BLOCKED],
    sourceId: route.id, sourceName: route.routeName,
    message: `${route.routeName} — ${issues[0] || "تحتاج مراجعة قبل البدء"}`,
    dedupKey: `${ALERT_TYPES.ROUTE_BLOCKED}:${route.id}`,
  };
}

/** Event-driven alert for a vehicle status problem — called when the issue is observed, not scanned continuously. */
export function buildVehicleIssueAlert(vehicle, reason) {
  return {
    type: ALERT_TYPES.VEHICLE_ISSUE, severity: SEVERITY[ALERT_TYPES.VEHICLE_ISSUE],
    sourceId: vehicle.id, sourceName: vehicle.vehicleNumber || vehicle.label,
    message: `${vehicle.vehicleNumber || vehicle.label} — ${reason}`,
    dedupKey: `${ALERT_TYPES.VEHICLE_ISSUE}:${vehicle.id}`,
  };
}
