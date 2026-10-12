/**
 * binContext.js — per-bin scoring context shared by every page AND the server-side
 * dispatch runner, so the browser and the server score bins identically:
 * thermal alert for the bin's neighborhood + open citizen reports pointing at the
 * bin (or, for reports without a bin id, at its neighborhood). Pure.
 */
import { normalizeNeighborhoodName } from "./config.js";

/** Thermal-alert lookup for a neighborhood name from the fire_sensors feed. */
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
