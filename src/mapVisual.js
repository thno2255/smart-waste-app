/**
 * mapVisual.js
 * ─────────────────────────────────────────────────────────────────────
 * Pure, framework-free visual-state rules for the operational map:
 *   • per-bin map state (fill band / no data / offline / fault)
 *   • per-neighborhood aggregate state (documented algorithm below)
 *   • filter predicates shared by polygons AND markers
 *   • Leaflet style helpers (transparent fills so roads/labels stay visible)
 *
 * Reuses THRESHOLDS + getSensorConnectivity + predictFutureState — nothing here
 * re-derives a threshold. No JSX, no Firestore: unit-tested in isolation
 * (src/__tests__/mapVisual.test.js) and cheap enough to run on thousands
 * of bins per render (one pass, no nested lookups).
 * ─────────────────────────────────────────────────────────────────────
 */
import { THRESHOLDS, STATUS_COLORS, getSensorConnectivity } from "./config";
import { predictFutureState } from "./prediction";

/** Map-state vocabulary → color. Fill bands reuse STATUS_COLORS; the two
 *  "not a fill level" states are deliberately grey and visually distinct. */
export const MAP_STATE_COLORS = {
  normal:   STATUS_COLORS.normal,    // fill < fillWarningPct (60%)   — green
  warning:  STATUS_COLORS.warning,   // 60% ≤ fill < fillCriticalPct — yellow/amber
  critical: STATUS_COLORS.critical,  // fill ≥ 85%                    — red
  no_data:  STATUS_COLORS.no_sensor, // no fill value / no reliable forecast — light grey
  offline:  STATUS_COLORS.offline,   // sensor silent > offlineTimeoutMin — dark grey, dashed ring
  fault:    "#7c3aed",               // out-of-range reading — purple ring (never confused with a fill band)
};

export const MAP_STATE_LABELS = {
  normal: "طبيعي", warning: "يحتاج متابعة", critical: "حرج (يحتاج تفريغًا)",
  no_data: "لا توجد بيانات كافية", offline: "غير متصل", fault: "خلل بالمستشعر",
};

/** Fill band from a numeric fill level only (the one place the 60/85 cutoffs are read for the map). */
export function fillBand(fill) {
  const v = Number(fill);
  if (fill == null || Number.isNaN(v)) return "no_data";
  if (v >= THRESHOLDS.fillCriticalPct) return "critical";
  if (v >= THRESHOLDS.fillWarningPct) return "warning";
  return "normal";
}

/**
 * Visual state of ONE bin on the map.
 * @param {object} bin                 Firestore bin (lastFillLevelPercent, lastTemperatureCelsius, lastReadingAt, deviceId)
 * @param {object} [opts]
 * @param {number} [opts.horizon=0]    hours ahead; 0 = actual readings
 * @param {Array}  [opts.readings=[]]  recent readings for this bin (used only when horizon > 0)
 * @param {number} [opts.now]
 * @returns {{state:string, color:string, fill:number|null, actualFill:number|null, predicted:boolean, forecastReason:string, connectivity:string, hot:boolean}}
 */
export function getBinMapState(bin, opts = {}) {
  const { horizon = 0, readings = [], now = Date.now() } = opts;
  const actualFill = bin?.lastFillLevelPercent == null ? null : Number(bin.lastFillLevelPercent);
  const temp = bin?.lastTemperatureCelsius == null ? null : Number(bin.lastTemperatureCelsius);
  const hot = temp != null && !Number.isNaN(temp) && temp >= THRESHOLDS.tempWarningC;

  // Connectivity first: a silent or faulty sensor is NEVER painted as a fill band.
  // getSensorConnectivity checks BOTH staleness and out-of-range stored values (fault).
  const connectivity = getSensorConnectivity(bin, null, now); // online|offline|fault|no_sensor
  if (connectivity === "offline" || connectivity === "fault") {
    return { state: connectivity, color: MAP_STATE_COLORS[connectivity], fill: actualFill, actualFill, predicted: false, forecastReason: "", connectivity, hot };
  }

  if (horizon > 0) {
    const f = predictFutureState(bin, readings, horizon);
    if (!f.predictionAvailable) {
      return { state: "no_data", color: MAP_STATE_COLORS.no_data, fill: null, actualFill, predicted: false, forecastReason: f.reason || "لا توجد بيانات كافية للتنبؤ", connectivity, hot };
    }
    const band = fillBand(f.predictedFillLevel);
    return { state: band, color: MAP_STATE_COLORS[band], fill: f.predictedFillLevel, actualFill, predicted: true, forecastReason: "", connectivity, hot };
  }

  const band = fillBand(actualFill);
  return { state: band, color: MAP_STATE_COLORS[band], fill: band === "no_data" ? null : actualFill, actualFill, predicted: false, forecastReason: "", connectivity, hot };
}

/** Does this bin need emptying soon? critical, or in the upper warning band (≥ fillHighPct) — shared by the "تحتاج جمع" filter and the panel. */
export function binNeedsCollection(binState) {
  if (!binState) return false;
  if (binState.state === "critical") return true;
  return binState.state === "warning" && binState.fill != null && binState.fill >= THRESHOLDS.fillHighPct;
}

/**
 * Aggregate state of a neighborhood from its bins' map states.
 *
 * Algorithm (in order; first match wins):
 *   0. no bins                         → no_data
 *   1. no valid fill readings          → no_data   (offline/fault/no-fill bins are "invalid" and excluded from the average, counted in invalidCount)
 *   2. offline+fault ≥ 50% of bins     → offline   (the data cannot be trusted; shown as a distinct dashed-grey indicator)
 *   3. critical ≥ 30% of valid bins, or ≥ 3 critical bins, or avg ≥ fillCriticalPct → critical
 *   4. any critical bin, or avg ≥ fillWarningPct, or (warning+critical) ≥ 50% of valid → warning
 *   5. otherwise                        → normal
 *
 * @param {Array<{state:string, fill:number|null, predicted:boolean}>} binStates
 * @param {{thermalAlert?: boolean}} [opts]
 */
export function computeNeighborhoodMapStats(binStates = [], opts = {}) {
  const { thermalAlert = false } = opts;
  const total = binStates.length;
  let criticalCount = 0, warningCount = 0, normalCount = 0, offlineCount = 0, faultCount = 0, noDataCount = 0, needsEmptyingCount = 0, predictedCount = 0;
  let fillSum = 0, validCount = 0;

  for (const s of binStates) {
    if (s.state === "offline") offlineCount += 1;
    else if (s.state === "fault") faultCount += 1;
    else if (s.state === "no_data") noDataCount += 1;
    else {
      validCount += 1; fillSum += s.fill;
      if (s.state === "critical") criticalCount += 1;
      else if (s.state === "warning") warningCount += 1;
      else normalCount += 1;
    }
    if (binNeedsCollection(s)) needsEmptyingCount += 1;
    if (s.predicted) predictedCount += 1;
  }

  const invalidCount = total - validCount;
  const avgFill = validCount ? Math.round(fillSum / validCount) : null;
  const criticalRatio = validCount ? criticalCount / validCount : 0;
  const warningRatio = validCount ? (criticalCount + warningCount) / validCount : 0;
  const disconnectedRatio = total ? (offlineCount + faultCount) / total : 0;

  let state;
  const reasons = [];
  if (total === 0) { state = "no_data"; reasons.push("لا توجد حاويات مسجلة في هذا الحي"); }
  else if (validCount === 0) { state = "no_data"; reasons.push(`لا توجد قراءات صالحة (${invalidCount} حاوية بلا بيانات أو غير متصلة)`); }
  else if (disconnectedRatio >= 0.5) { state = "offline"; reasons.push(`${offlineCount + faultCount} من ${total} حاوية غير متصلة أو بها خلل — البيانات غير موثوقة`); }
  else if (criticalRatio >= 0.3 || criticalCount >= 3 || avgFill >= THRESHOLDS.fillCriticalPct) {
    state = "critical";
    if (criticalCount > 0) reasons.push(`${criticalCount} حاوية حرجة (${Math.round(criticalRatio * 100)}% من الحاويات الصالحة)`);
    if (avgFill >= THRESHOLDS.fillCriticalPct) reasons.push(`متوسط الامتلاء ${avgFill}%`);
  } else if (criticalCount >= 1 || avgFill >= THRESHOLDS.fillWarningPct || warningRatio >= 0.5) {
    state = "warning";
    if (criticalCount > 0) reasons.push(`${criticalCount} حاوية حرجة`);
    if (warningCount > 0) reasons.push(`${warningCount} حاوية تحتاج متابعة`);
    reasons.push(`متوسط الامتلاء ${avgFill}%`);
  } else { state = "normal"; reasons.push(`جميع الحاويات ضمن المعدل الطبيعي (متوسط ${avgFill}%)`); }

  if (thermalAlert) reasons.push("🔥 تنبيه حراري نشط في الحي");
  if (invalidCount > 0 && state !== "no_data" && state !== "offline") reasons.push(`${invalidCount} قراءة مستبعدة من المتوسط (غير متصلة/خلل/بلا بيانات)`);

  return {
    state, color: MAP_STATE_COLORS[state], reasons, thermalAlert,
    total, validCount, invalidCount, avgFill,
    criticalCount, criticalRatio: Math.round(criticalRatio * 100) / 100, warningCount, normalCount,
    needsEmptyingCount, offlineCount, faultCount, noDataCount, predictedCount,
  };
}

export const MAP_FILTER_KEYS = ["all", "critical", "offline", "thermal", "needsCollection"];

/** Filter predicate for a bin — `thermal` needs the bin's neighborhood flag passed in. */
export function binMatchesFilter(filterKey, binState, { thermalAlert = false } = {}) {
  switch (filterKey) {
    case "critical": return binState.state === "critical";
    case "offline": return binState.state === "offline" || binState.state === "fault";
    case "needsCollection": return binNeedsCollection(binState);
    case "thermal": return !!thermalAlert;
    default: return true;
  }
}

/** Same filter applied to a neighborhood — a polygon "matches" when at least one of its bins would. */
export function neighborhoodMatchesFilter(filterKey, stats) {
  switch (filterKey) {
    case "critical": return stats.criticalCount > 0;
    case "offline": return stats.offlineCount + stats.faultCount > 0;
    case "needsCollection": return stats.needsEmptyingCount > 0;
    case "thermal": return !!stats.thermalAlert;
    default: return true;
  }
}

/** Leaflet path style for a neighborhood polygon. Fills stay translucent so base-map roads/labels read through. */
export function polygonStyle(stats, { selected = false, dimmed = false } = {}) {
  const color = stats.color;
  if (dimmed) return { color: STATUS_COLORS.no_sensor, weight: 1, fillColor: STATUS_COLORS.no_sensor, fillOpacity: 0.04, opacity: 0.35, dashArray: null };
  const base = { color, weight: selected ? 3.5 : 2, fillColor: color, fillOpacity: selected ? 0.38 : 0.22, opacity: 0.9, dashArray: null };
  if (stats.state === "offline") base.dashArray = "6 6";
  if (stats.thermalAlert) { base.color = STATUS_COLORS.critical; base.weight = selected ? 4 : 3; }
  return base;
}

/** Leaflet path style for a bin marker. Predicted values get a dashed ring; offline/fault get a hollow ring. */
export function markerStyle(binState, { highlighted = false } = {}) {
  const hollow = binState.state === "offline" || binState.state === "fault";
  return {
    color: highlighted ? "#3b82f6" : hollow ? binState.color : "#ffffff",
    weight: highlighted ? 3 : hollow ? 2.5 : 1,
    fillColor: hollow ? "#ffffff" : binState.color,
    fillOpacity: binState.state === "no_data" ? 0.55 : hollow ? 0.9 : 0.95,
    dashArray: binState.predicted ? "3 3" : null,
  };
}
