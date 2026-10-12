/**
 * sensorHealth.js
 * ─────────────────────────────────────────────────────────────────────
 * Sensor health is a SEPARATE dimension from bin priority (Phase 3 §30):
 * a bin can be critically full with a perfectly healthy sensor, and a
 * bin can have a faulty/stuck sensor while its actual fill level is low.
 * Never conflate the two — decisionEngine.js uses this module's output
 * only to discount CONFIDENCE in a priority score, never to inflate or
 * deflate the underlying fill/temperature reading itself.
 * ─────────────────────────────────────────────────────────────────────
 */

import { THRESHOLDS, getSensorConnectivity } from "./config.js";
import { detectAnomalies } from "./prediction.js";

/**
 * @param {object} bin
 * @param {object} [latestReading]
 * @param {Array<object>} [recentReadings] bounded window, not full history
 * @returns {{status: "healthy"|"warning"|"fault", reasons: string[], connectivity: string}}
 */
export function getSensorHealth(bin, latestReading, recentReadings = []) {
  const connectivity = getSensorConnectivity(bin, latestReading);
  const reasons = [];

  if (connectivity === "no_sensor") {
    return { status: "warning", connectivity, reasons: ["لا يوجد مستشعر مرتبط بهذه الحاوية بعد"] };
  }
  if (connectivity === "fault") {
    return { status: "fault", connectivity, reasons: ["آخر قراءة خارج النطاق المنطقي — القراءة غير موثوقة"] };
  }

  const anomalies = detectAnomalies(recentReadings);
  const hasStuck = anomalies.some((a) => a.type === "stuck_sensor");
  const hasJumpOrOsc = anomalies.some((a) => a.type === "unrealistic_jump" || a.type === "oscillation" || a.type === "temperature_jump");

  if (connectivity === "offline") {
    reasons.push("المستشعر غير متصل حاليًا");
    return { status: hasStuck || hasJumpOrOsc ? "fault" : "warning", connectivity, reasons };
  }

  // connectivity === "online" from here
  if (hasStuck) {
    reasons.push(...anomalies.filter((a) => a.type === "stuck_sensor").map((a) => a.reason));
  }
  if (hasJumpOrOsc) {
    reasons.push(...anomalies.filter((a) => a.type === "unrealistic_jump" || a.type === "oscillation" || a.type === "temperature_jump").map((a) => a.reason));
  }

  const battery = latestReading?.battery_level ?? bin?.lastBatteryLevel;
  if (battery != null && Number(battery) < THRESHOLDS.lowBatteryPct) {
    reasons.push(`مستوى البطارية منخفض (${battery}%)`);
  }

  if (hasStuck) return { status: "fault", connectivity, reasons };
  if (hasJumpOrOsc || reasons.length > 0) return { status: "warning", connectivity, reasons };
  return { status: "healthy", connectivity, reasons: [] };
}
