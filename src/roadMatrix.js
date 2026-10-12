/**
 * roadMatrix.js — OSRM table service (travel time over the road network), React-free so the
 * server-side dispatch runner and the browser share it. Returns null when the service is
 * unavailable or slow; callers MUST fall back to an estimate and say so.
 */
const keyFor = (points) => points.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join(";");
const OSRM_TABLE = "https://router.project-osrm.org/table/v1/driving";
const tableCache = new Map();
/**
 * Full duration+distance matrix between points (OSRM table service). Index
 * order matches the input. Returns null when unavailable → callers fall back
 * to routeOptimizer.haversineMatrix and label the result as estimated.
 * @returns {Promise<{durations:number[][], distances:number[][], source:"osrm"}|null>}
 */
export async function fetchRoadMatrix(points, { signal, timeoutMs = 8000 } = {}) {
  const pts = (points || []).filter((p) => p && p.lat != null && p.lng != null);
  if (pts.length < 2 || pts.length > 60) return null;
  const key = "T:" + keyFor(pts);
  if (tableCache.has(key)) return tableCache.get(key);
  const coords = pts.map((p) => `${p.lng},${p.lat}`).join(";");
  try {
    const ctl = signal ? null : new AbortController();
    const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
    const res = await fetch(`${OSRM_TABLE}/${coords}?annotations=duration,distance`, { signal: signal || ctl.signal }).finally(() => timer && clearTimeout(timer));
    if (!res.ok) return null;
    const data = await res.json();
    if (data.code !== "Ok" || !data.durations) return null;
    const result = {
      durations: data.durations.map((row) => row.map((s) => (s == null ? 1e6 : s / 60))),
      distances: (data.distances || data.durations.map((row) => row.map(() => null))).map((row) => row.map((m) => (m == null ? 1e6 : m / 1000))),
      source: "osrm",
    };
    tableCache.set(key, result);
    return result;
  } catch { return null; }
}
