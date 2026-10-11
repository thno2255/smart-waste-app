/**
 * roadRouting.js
 * ─────────────────────────────────────────────────────────────────────
 * Real road geometry + drive time for an ORDERED list of stops, from the
 * public OSRM demo server (open source, no key, no cost). Stop ORDER is
 * still decided by decisionEngine (priority + nearest-neighbor); OSRM only
 * turns that order into an actual street path and a realistic duration.
 *
 * Every caller must keep working when OSRM is unreachable (demo server,
 * rate-limited, offline hall Wi-Fi): fetchRoadRoute() returns null and the
 * UI falls back to straight lines + Haversine, and SAYS so.
 * ─────────────────────────────────────────────────────────────────────
 */
import { useEffect, useState } from "react";

const OSRM_BASE = "https://router.project-osrm.org/route/v1/driving";
const cache = new Map();
const MAX_STOPS = 25; // demo-server courtesy limit per request

function keyFor(points) {
  return points.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join(";");
}

/**
 * @param {Array<{lat:number,lng:number}>} points ordered, ≥2
 * @returns {Promise<{coordinates:Array<[number,number]>, distanceKm:number, durationMin:number, legs:Array<{distanceKm:number,durationMin:number}>}|null>}
 */
export async function fetchRoadRoute(points, { signal, steps = false } = {}) {
  const pts = (points || []).filter((p) => p && p.lat != null && p.lng != null).slice(0, MAX_STOPS);
  if (pts.length < 2) return null;
  const key = (steps ? "S:" : "") + keyFor(pts);
  if (cache.has(key)) return cache.get(key);

  const coords = pts.map((p) => `${p.lng},${p.lat}`).join(";");
  const url = `${OSRM_BASE}/${coords}?overview=full&geometries=geojson&steps=${steps ? "true" : "false"}`;
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    const data = await res.json();
    const route = data?.routes?.[0];
    if (data.code !== "Ok" || !route) return null;
    const result = {
      coordinates: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]), // Leaflet order
      distanceKm: Math.round((route.distance / 1000) * 10) / 10,
      durationMin: Math.max(1, Math.round(route.duration / 60)),
      legs: (route.legs || []).map((l) => ({ distanceKm: Math.round((l.distance / 1000) * 100) / 100, durationMin: Math.round(l.duration / 60) })),
      raw: steps ? { legs: route.legs } : undefined, // OSRM steps for turn-by-turn (navigation.parseSteps)
    };
    cache.set(key, result);
    return result;
  } catch {
    return null;
  }
}

/**
 * React hook: road route for an ordered point list. `status` is one of
 * idle | loading | ok | unavailable — "unavailable" means straight-line fallback.
 */
export function useRoadRoute(points) {
  const key = keyFor((points || []).filter((p) => p && p.lat != null && p.lng != null));
  const [state, setState] = useState({ key: null, route: null, status: "idle" });

  useEffect(() => {
    const pts = (points || []).filter((p) => p && p.lat != null && p.lng != null);
    if (pts.length < 2) return;
    if (cache.has(key)) return; // handled synchronously below
    const controller = new AbortController();
    fetchRoadRoute(pts, { signal: controller.signal }).then((route) => {
      if (controller.signal.aborted) return;
      setState({ key, route, status: route ? "ok" : "unavailable" });
    });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (cache.has(key)) return { route: cache.get(key), status: "ok" };
  if (state.key === key) return { route: state.route, status: state.status };
  return { route: null, status: key ? "loading" : "idle" };
}

/**
 * React hook: real road legs for SEVERAL independent origin→destination
 * pairs at once (e.g. every candidate driver → the route's first stop).
 * Returns { byKey: {key → {distanceKm,durationMin}|null}, status } where
 * status is idle | loading | done. Missing/failed pairs are null so the
 * caller falls back to its own estimate and labels it as such.
 * @param {Array<{key:string, from:{lat,lng}|null, to:{lat,lng}|null}>} pairs
 */
export function useRoadLegs(pairs) {
  const valid = (pairs || []).filter((p) => p && p.from && p.to && p.from.lat != null && p.to.lat != null);
  const sig = valid.map((p) => `${p.key}=${keyFor([p.from, p.to])}`).join("|");
  const [state, setState] = useState({ sig: null, byKey: {}, status: "idle" });

  useEffect(() => {
    if (!sig) return;
    const controller = new AbortController();
    Promise.all(valid.map(async (p) => [p.key, await fetchRoadRoute([p.from, p.to], { signal: controller.signal })]))
      .then((entries) => { if (!controller.signal.aborted) setState({ sig, byKey: Object.fromEntries(entries.map(([k, r]) => [k, r ? { distanceKm: r.distanceKm, durationMin: r.durationMin } : null])), status: "done" }); });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  if (!sig) return { byKey: {}, status: "idle" };
  if (state.sig === sig) return { byKey: state.byKey, status: state.status };
  // Serve cached legs synchronously while the batch is in flight.
  const cached = {};
  for (const p of valid) { const k = keyFor([p.from, p.to]); if (cache.has(k)) { const r = cache.get(k); cached[p.key] = r ? { distanceKm: r.distanceKm, durationMin: r.durationMin } : null; } }
  return { byKey: cached, status: "loading" };
}

const OSRM_TABLE = "https://router.project-osrm.org/table/v1/driving";
const tableCache = new Map();
/**
 * Full duration+distance matrix between points (OSRM table service). Index
 * order matches the input. Returns null when unavailable → callers fall back
 * to routeOptimizer.haversineMatrix and label the result as estimated.
 * @returns {Promise<{durations:number[][], distances:number[][], source:"osrm"}|null>}
 */
export async function fetchRoadMatrix(points, { signal } = {}) {
  const pts = (points || []).filter((p) => p && p.lat != null && p.lng != null);
  if (pts.length < 2 || pts.length > 60) return null;
  const key = "T:" + keyFor(pts);
  if (tableCache.has(key)) return tableCache.get(key);
  const coords = pts.map((p) => `${p.lng},${p.lat}`).join(";");
  try {
    const res = await fetch(`${OSRM_TABLE}/${coords}?annotations=duration,distance`, { signal });
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
