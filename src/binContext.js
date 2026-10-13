/**
 * binContext.js — per-bin scoring context shared by every page AND the server-side
 * dispatch runner, so the browser and the server score bins identically:
 * thermal alert for the bin's neighborhood + open citizen reports pointing at the
 * bin (or, for reports without a bin id, at its neighborhood). Pure.
 */
import { normalizeNeighborhoodName, getSensorConnectivity, THRESHOLDS } from "./config.js";

/** Risk label for a measured in-bin temperature — the same vocabulary the thermal feed always used. */
export const thermalRiskLevel = (tempC) => {
  if (tempC == null || Number.isNaN(Number(tempC))) return "غير معروف";
  const t = Number(tempC);
  if (t >= THRESHOLDS.tempDangerC) return "خطر عالي";
  if (t >= THRESHOLDS.tempCriticalC) return "خطر متوسط";
  if (t >= THRESHOLDS.tempHighC) return "تحذير";
  return "آمن";
};

/**
 * Per-neighborhood thermal feed derived from the bins' OWN temperature probes
 * (replaces the seeded fire_sensors collection). Only bins whose sensor is
 * currently online count: a stale or out-of-range temperature must never
 * raise or clear an alert. Shape matches what makeThermalAlertFor expects.
 */
export const thermalFeedFromBins = (bins = [], neighborhoods = [], now = Date.now()) => {
  const nameById = Object.fromEntries(neighborhoods.map((n) => [n.id, n.name]));
  const byName = new Map();
  for (const b of bins) {
    const name = nameById[b.neighborhoodId];
    if (!name || b.lastTemperatureCelsius == null) continue;
    if (getSensorConnectivity(b, null, now) !== "online") continue;
    const t = Number(b.lastTemperatureCelsius);
    if (Number.isNaN(t)) continue;
    const key = normalizeNeighborhoodName(name);
    const e = byName.get(key) || { district: name, maxTemp: -Infinity, binsWithTemp: 0, hotBinIds: [] };
    e.binsWithTemp += 1;
    if (t > e.maxTemp) e.maxTemp = t;
    if (t >= THRESHOLDS.tempHighC) e.hotBinIds.push(b.id);
    byName.set(key, e);
  }
  return [...byName.values()].map((e) => ({ ...e, riskLevel: thermalRiskLevel(e.maxTemp) }));
};

/** Thermal-alert lookup for a neighborhood name from a thermal feed (see thermalFeedFromBins). */
export const makeThermalAlertFor = (fireSensors = []) => (name) =>
  fireSensors.some((s) => normalizeNeighborhoodName(s.district) === normalizeNeighborhoodName(name) && (s.riskLevel === "خطر عالي" || s.riskLevel === "خطر متوسط"));

export const makeBinContext = (fireSensors = [], citizenReports = [], neighborhoods = []) => {
  const thermalFor = makeThermalAlertFor(fireSensors);
  const open = citizenReports.filter((r) => r.status !== "تم الحل" && r.status !== "مرفوض" && r.status !== "مغلق");
  const byBin = {}, byNeighborhoodKey = {};
  for (const r of open) {
    if (r.binId) byBin[r.binId] = (byBin[r.binId] || 0) + 1;
    else if (r.district) { const k = normalizeNeighborhoodName(r.district); byNeighborhoodKey[k] = (byNeighborhoodKey[k] || 0) + 1; }
  }
  const nameById = Object.fromEntries(neighborhoods.map((n) => [n.id, n.name]));
  return {
    forBin: (bin) => {
      const name = nameById[bin.neighborhoodId] || "";
      return { thermalAlert: name ? thermalFor(name) : false, citizenReportCount: byBin[bin.id] || 0 };
    },
    forNeighborhoodName: (name) => ({ thermalAlert: thermalFor(name), citizenReportCount: byNeighborhoodKey[normalizeNeighborhoodName(name)] || 0 }),
    reportCountForBin: (binId) => byBin[binId] || 0,
    reportCountForNeighborhood: (name) => (byNeighborhoodKey[normalizeNeighborhoodName(name)] || 0) + open.filter((r) => r.binId && nameById[r.binNeighborhoodId || ""] === name).length,
    openCount: open.length,
  };
};
