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
export async function fetchRoadRoute(points, { signal } = {}) {
  const pts = (points || []).filter((p) => p && p.lat != null && p.lng != null).slice(0, MAX_STOPS);
  if (pts.length < 2) return null;
  const key = keyFor(pts);
  if (cache.has(key)) return cache.get(key);

  const coords = pts.map((p) => `${p.lng},${p.lat}`).join(";");
  const url = `${OSRM_BASE}/${coords}?overview=full&geometries=geojson&steps=false`;
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
