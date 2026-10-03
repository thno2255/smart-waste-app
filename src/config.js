/**
 * config.js
 * ─────────────────────────────────────────────────────────────────────
 * Centralized thresholds + status logic — single source of truth.
 * Previously these thresholds/status rules were duplicated separately in
 * App.jsx (local getStatus) and firestoreService.js (getStatus/getStatusColor).
 * Both now import from here instead.
 *
 * Pure module: no JSX, no Firestore imports — safe to import from the
 * browser bundle AND from a Node-side Vercel API route (e.g. the future
 * /api/iot/readings endpoint), so status logic never drifts between the
 * client and the server.
 * ─────────────────────────────────────────────────────────────────────
 */

export const THRESHOLDS = {
  fillWarningPct:  60,   // reuses the existing getStatus "تحذير" cutoff
  fillCriticalPct: 85,   // reuses the existing getStatus "حرج" cutoff
  tempWarningC:    45,
  tempCriticalC:   60,   // reuses FireAlertPage's existing alarm line
  tempDangerC:     75,   // reuses FireAlertPage's existing danger line
  offlineTimeoutMin: 30, // no reading within this window => Offline
  faultReadingBounds: { fillMin: 0, fillMax: 100, tempMin: -10, tempMax: 120 },
  predictionWindowHours: 24,
};

export const STATUS_COLORS = {
  normal:   "#10b981", // reuses C.accent
  warning:  "#f59e0b", // reuses C.warning
  critical: "#ef4444", // reuses C.danger
  offline:  "#64748b", // reuses C.dim — the 5th state, not yet used anywhere until bins carry live sensors
};

/**
 * Fill-level status (Arabic labels, matches existing call sites across the app).
 * Single source of truth — same thresholds/output as the two previously-duplicated copies.
 */
export const getStatus = (fillLevel) => {
  const v = Number(fillLevel) || 0;
  if (v >= THRESHOLDS.fillCriticalPct) return "حرج";
  if (v >= THRESHOLDS.fillWarningPct) return "تحذير";
  return "طبيعي";
};

export const getStatusColor = (fillLevel) => {
  const v = Number(fillLevel) || 0;
  if (v >= THRESHOLDS.fillCriticalPct) return STATUS_COLORS.critical;
  if (v >= THRESHOLDS.fillWarningPct) return STATUS_COLORS.warning;
  return STATUS_COLORS.normal;
};

/**
 * Full bin status including connectivity/fault states.
 * Not wired into any page yet (bins don't carry live sensor readings until
 * later phases) — defined now so the eventual Dashboard/Map/Bins-page cutover
 * has one ready-made function to call instead of re-deriving this logic.
 *
 * @param {{deviceId?: string, lastReadingAt?: string, lastFillLevelPercent?: number}} bin
 * @param {{fill_level_percent?: number, temperature_celsius?: number, timestamp?: string}} [latestReading]
 * @returns {"normal"|"warning"|"critical"|"offline"|"fault"}
 */
export function getBinStatus(bin, latestReading, now = Date.now()) {
  const bounds = THRESHOLDS.faultReadingBounds;

  if (latestReading) {
    const fill = Number(latestReading.fill_level_percent);
    const temp = Number(latestReading.temperature_celsius);
    const outOfRange =
      Number.isNaN(fill) || fill < bounds.fillMin || fill > bounds.fillMax ||
      (latestReading.temperature_celsius != null &&
        (Number.isNaN(temp) || temp < bounds.tempMin || temp > bounds.tempMax));
    if (outOfRange) return "fault";
  }

  const lastReadingAt = latestReading?.timestamp || bin?.lastReadingAt;
  if (lastReadingAt) {
    const ageMin = (now - new Date(lastReadingAt).getTime()) / 60000;
    if (ageMin > THRESHOLDS.offlineTimeoutMin) return "offline";
  } else if (bin?.deviceId) {
    // a device is assigned but has never reported in — treat as offline, not normal
    return "offline";
  }

  const fill = Number(latestReading?.fill_level_percent ?? bin?.lastFillLevelPercent ?? 0);
  const rawTemp = latestReading?.temperature_celsius ?? bin?.lastTemperatureCelsius;
  const temp = rawTemp == null ? null : Number(rawTemp);

  // tempDangerC (75°C) is intentionally not used here — that tier belongs to
  // FireAlertPage's own fire-specific risk scale, not this 4-state bin model.
  if (fill >= THRESHOLDS.fillCriticalPct || (temp != null && temp >= THRESHOLDS.tempCriticalC)) return "critical";
  if (fill >= THRESHOLDS.fillWarningPct || (temp != null && temp >= THRESHOLDS.tempWarningC)) return "warning";
  return "normal";
}
