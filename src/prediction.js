/**
 * prediction.js
 * ─────────────────────────────────────────────────────────────────────
 * Pure, Firestore-free prediction logic for a single bin's sensor_readings
 * history. Callers are responsible for querying a BOUNDED, time-windowed
 * set of readings (e.g. last THRESHOLDS.predictionWindowHours) — this
 * module never fetches data itself and never assumes it was handed the
 * full history (performance guidance: never load full sensor_readings
 * history for a dashboard-scale operation).
 *
 * No ML anywhere here — linear/statistical only, and every function
 * returns an explicit "not enough data" result instead of fabricating
 * a number when the input is too thin or unreliable.
 * ─────────────────────────────────────────────────────────────────────
 */

import { THRESHOLDS } from "./config.js";

const HOUR_MS = 60 * 60 * 1000;

/** Sorts readings by timestamp ascending, de-duplicating identical timestamps (keeps the last). */
function normalizeReadings(readings = []) {
  const byTime = new Map();
  for (const r of readings) {
    if (!r || r.timestamp == null || r.fill_level_percent == null) continue;
    const t = new Date(r.timestamp).getTime();
    if (Number.isNaN(t)) continue;
    byTime.set(t, { ...r, _t: t });
  }
  return Array.from(byTime.values()).sort((a, b) => a._t - b._t);
}

/**
 * Detects a "collection reset" — a large sudden fill drop between two
 * consecutive readings, which means the bin was emptied, not that fill
 * is trending down. Readings before the most recent reset are irrelevant
 * to the CURRENT trend and must be excluded from fill-rate calculations.
 */
export function detectCollectionResets(readings = []) {
  const sorted = normalizeReadings(readings);
  const resets = [];
  for (let i = 1; i < sorted.length; i++) {
    const drop = sorted[i - 1].fill_level_percent - sorted[i].fill_level_percent;
    // A drop bigger than the configured threshold (or more than half the
    // previous value) is a collection, not a normal reading fluctuation.
    if (drop >= THRESHOLDS.collectionResetDropPct || (sorted[i - 1].fill_level_percent > 0 && drop >= sorted[i - 1].fill_level_percent * 0.5 && drop > 10)) {
      resets.push({ atIndex: i, timestamp: sorted[i].timestamp, fromPct: sorted[i - 1].fill_level_percent, toPct: sorted[i].fill_level_percent });
    }
  }
  return resets;
}

/**
 * Rule-based anomaly scan — NOT ML. Flags: out-of-range values, unrealistic
 * jumps (excluding collection resets, which are drops not jumps), a sensor
 * stuck on one value for too long, and heavy oscillation (reading direction
 * flipping back and forth repeatedly).
 * @returns {Array<{type:string, reason:string, timestamp?:string}>}
 */
export function detectAnomalies(readings = []) {
  const sorted = normalizeReadings(readings);
  const anomalies = [];
  const bounds = THRESHOLDS.faultReadingBounds;

  for (const r of sorted) {
    if (r.fill_level_percent < bounds.fillMin || r.fill_level_percent > bounds.fillMax) {
      anomalies.push({ type: "out_of_range", reason: `قراءة امتلاء خارج النطاق المنطقي: ${r.fill_level_percent}%`, timestamp: r.timestamp });
    }
    if (r.temperature_celsius != null && (r.temperature_celsius < bounds.tempMin || r.temperature_celsius > bounds.tempMax)) {
      anomalies.push({ type: "out_of_range", reason: `قراءة حرارة خارج النطاق المنطقي: ${r.temperature_celsius}°`, timestamp: r.timestamp });
    }
  }

  // Unrealistic jump: a rise bigger than the configured max plausible rise
  // per hour, happening faster than that — excludes drops (handled as resets).
  for (let i = 1; i < sorted.length; i++) {
    const hours = (sorted[i]._t - sorted[i - 1]._t) / HOUR_MS;
    if (hours <= 0) continue;
    const rise = sorted[i].fill_level_percent - sorted[i - 1].fill_level_percent;
    if (rise > 0 && rise / hours > THRESHOLDS.maxPlausibleFillRisePerHour) {
      anomalies.push({ type: "unrealistic_jump", reason: `قفزة امتلاء غير منطقية: +${rise}% خلال ${hours.toFixed(1)} ساعة`, timestamp: sorted[i].timestamp });
    }
    if (sorted[i].temperature_celsius != null && sorted[i - 1].temperature_celsius != null) {
      const tempJump = Math.abs(sorted[i].temperature_celsius - sorted[i - 1].temperature_celsius);
      if (tempJump > THRESHOLDS.maxPlausibleTempJump) {
        anomalies.push({ type: "temperature_jump", reason: `قفزة حرارة مفاجئة: ${tempJump.toFixed(1)}° خلال ${hours.toFixed(1)} ساعة`, timestamp: sorted[i].timestamp });
      }
    }
  }

  // Stuck sensor: N+ consecutive identical fill readings spanning a long window.
  if (sorted.length >= THRESHOLDS.stuckSensorMinReadings) {
    for (let i = THRESHOLDS.stuckSensorMinReadings - 1; i < sorted.length; i++) {
      const window = sorted.slice(i - THRESHOLDS.stuckSensorMinReadings + 1, i + 1);
      const allSame = window.every((r) => r.fill_level_percent === window[0].fill_level_percent);
      const spanHours = (window[window.length - 1]._t - window[0]._t) / HOUR_MS;
      if (allSame && spanHours >= THRESHOLDS.stuckSensorMinHours) {
        anomalies.push({ type: "stuck_sensor", reason: `المستشعر ثابت على ${window[0].fill_level_percent}% منذ ${spanHours.toFixed(1)} ساعة بدون تغيّر`, timestamp: window[window.length - 1].timestamp });
        break; // one flag is enough, avoid flooding
      }
    }
  }

  // Heavy oscillation: direction reverses on most consecutive steps.
  if (sorted.length >= 5) {
    let reversals = 0;
    let steps = 0;
    for (let i = 2; i < sorted.length; i++) {
      const prevDir = Math.sign(sorted[i - 1].fill_level_percent - sorted[i - 2].fill_level_percent);
      const curDir = Math.sign(sorted[i].fill_level_percent - sorted[i - 1].fill_level_percent);
      if (prevDir !== 0 && curDir !== 0) {
        steps += 1;
        if (prevDir !== curDir) reversals += 1;
      }
    }
    if (steps >= 4 && reversals / steps >= THRESHOLDS.oscillationReversalRatio) {
      anomalies.push({ type: "oscillation", reason: "تذبذب شديد وغير منطقي في قراءات الامتلاء" });
    }
  }

  return anomalies;
}

/**
 * Fill rate (%/hour), computed over the segment AFTER the most recent
 * collection reset (if any) — using simple linear regression (least
 * squares), not a naive two-point slope, so a couple of noisy points
 * don't swing the estimate wildly.
 * @returns {{ratePerHour: number|null, reliable: boolean, pointsUsed: number, reason: string}}
 */
export function computeFillRate(readings = []) {
  const sorted = normalizeReadings(readings);
  if (sorted.length < 2) {
    return { ratePerHour: null, reliable: false, pointsUsed: sorted.length, reason: "عدد القراءات غير كافٍ لحساب معدل الامتلاء" };
  }

  const resets = detectCollectionResets(sorted);
  const segment = resets.length > 0 ? sorted.slice(resets[resets.length - 1].atIndex) : sorted;

  if (segment.length < 2) {
    return { ratePerHour: null, reliable: false, pointsUsed: segment.length, reason: "لا توجد قراءات كافية بعد آخر عملية تفريغ" };
  }

  const anomalies = detectAnomalies(segment);
  const hasBlockingAnomaly = anomalies.some((a) => a.type === "unrealistic_jump" || a.type === "oscillation" || a.type === "out_of_range");

  const t0 = segment[0]._t;
  const xs = segment.map((r) => (r._t - t0) / HOUR_MS);
  const ys = segment.map((r) => r.fill_level_percent);
  const n = xs.length;
  const sumX = xs.reduce((a, v) => a + v, 0);
  const sumY = ys.reduce((a, v) => a + v, 0);
  const sumXY = xs.reduce((a, v, i) => a + v * ys[i], 0);
  const sumXX = xs.reduce((a, v) => a + v * v, 0);
  const denom = n * sumXX - sumX * sumX;

  if (denom === 0) {
    return { ratePerHour: 0, reliable: false, pointsUsed: n, reason: "القراءات متقاربة جدًا زمنيًا لتقدير معدل موثوق" };
  }

  const slope = (n * sumXY - sumX * sumY) / denom; // %/hour

  return {
    ratePerHour: slope,
    reliable: n >= THRESHOLDS.minReadingsForReliablePrediction && !hasBlockingAnomaly,
    pointsUsed: n,
    reason: hasBlockingAnomaly ? "توجد قراءات شاذة تقلل من موثوقية المعدل" : (n >= THRESHOLDS.minReadingsForReliablePrediction ? "" : "عدد القراءات أقل من الحد الأدنى الموصى به"),
  };
}

/**
 * Predicted-full-time — the §6/§8 shape. Never fabricates a value: if the
 * rate isn't reliable or isn't currently rising, predictionAvailable is false.
 */
export function predictFullTime(bin, readings = []) {
  const currentFill = Number(bin?.lastFillLevelPercent ?? readings[readings.length - 1]?.fill_level_percent);
  const rate = computeFillRate(readings);

  if (!rate.reliable || rate.ratePerHour == null) {
    return { predictionAvailable: false, predictedFullAt: null, hoursToFull: null, confidence: "low", reason: rate.reason || "لا توجد بيانات كافية للتنبؤ" };
  }
  if (rate.ratePerHour <= 0) {
    return { predictionAvailable: false, predictedFullAt: null, hoursToFull: null, confidence: "low", reason: "معدل الامتلاء غير متزايد حاليًا" };
  }
  if (Number.isNaN(currentFill)) {
    return { predictionAvailable: false, predictedFullAt: null, hoursToFull: null, confidence: "low", reason: "لا توجد قراءة امتلاء حالية" };
  }

  const hoursToFull = Math.max(0, (100 - currentFill) / rate.ratePerHour);
  const predictedFullAt = new Date(Date.now() + hoursToFull * HOUR_MS).toISOString();

  let confidence = "low";
  if (rate.pointsUsed >= THRESHOLDS.highConfidenceMinReadings) confidence = "high";
  else if (rate.pointsUsed >= THRESHOLDS.minReadingsForReliablePrediction) confidence = "medium";

  return { predictionAvailable: true, predictedFullAt, hoursToFull, confidence, reason: "" };
}

/**
 * Predicted fill level at +1h/+3h/+6h (or any custom horizon), clamped to
 * [0,100]. Returns predictionAvailable:false with an explicit reason
 * instead of a guess when the rate isn't reliable.
 */
export function predictFutureState(bin, readings = [], hoursAhead = 1) {
  const currentFill = Number(bin?.lastFillLevelPercent ?? readings[readings.length - 1]?.fill_level_percent);
  const rate = computeFillRate(readings);

  if (!rate.reliable || rate.ratePerHour == null || Number.isNaN(currentFill)) {
    return { predictionAvailable: false, predictedFillLevel: null, hoursAhead, reason: rate.reason || "لا توجد بيانات كافية للتنبؤ" };
  }

  const predictedFillLevel = Math.max(0, Math.min(100, Math.round(currentFill + rate.ratePerHour * hoursAhead)));
  return { predictionAvailable: true, predictedFillLevel, hoursAhead, reason: "" };
}
