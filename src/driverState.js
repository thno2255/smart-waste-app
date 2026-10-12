/**
 * driverState.js — operational state of a driver + vehicle, and shift time windows.
 * ─────────────────────────────────────────────────────────────────────
 * Pure. Used by the dispatch engine (who can take work, and from when), the
 * fleet monitor and the decision explanations. A driver on a route is NOT
 * "unavailable": the engine asks when they will be free, from where, with how
 * much room left in the truck and how much of the shift remains.
 *
 * Shift times on driver profiles are local wall-clock "HH:MM" (Buraidah, UTC+3).
 * The offset is a parameter so the server (UTC) and the browser agree.
 * Remaining-route time is an estimate from the pending stops (straight-line
 * distance at the documented urban speed + service minutes per stop) and is
 * labelled as such wherever it is shown.
 * ─────────────────────────────────────────────────────────────────────
 */
import { ACTIVE_ROUTE_STATUSES } from "./fleetEngine.js";
import { haversineDistanceKm, estimateTravelMinutes } from "./decisionEngine.js";
import { ASSUMPTIONS } from "./impact.js";

export const DRIVER_STATES = {
  AVAILABLE: "AVAILABLE",
  ON_ROUTE: "ON_ROUTE",
  NEXT_ROUTE_RESERVED: "NEXT_ROUTE_RESERVED",
  OFF_SHIFT: "OFF_SHIFT",
  VEHICLE_FULL: "VEHICLE_FULL",
  VEHICLE_FAULT: "VEHICLE_FAULT",
  UNAVAILABLE: "UNAVAILABLE",
};
export const DRIVER_STATE_LABELS = {
  AVAILABLE: "متاح",
  ON_ROUTE: "في جولة",
  NEXT_ROUTE_RESERVED: "في جولة وله جولة تالية محجوزة",
  OFF_SHIFT: "خارج المناوبة",
  VEHICLE_FULL: "المركبة ممتلئة",
  VEHICLE_FAULT: "المركبة متعطلة",
  UNAVAILABLE: "غير متاح",
};

/** Riyadh local time (UTC+3, no DST). */
export const DEFAULT_TZ_OFFSET_MIN = 180;

/** Waste a single critical bin adds (standard 1100 L bin at the critical threshold) — below this the truck cannot take another stop. */
export const DEFAULT_FULL_THRESHOLD_L = Math.round(1100 * 0.85);

const parseHHMM = (s) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || "").trim());
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  return h < 24 && mi < 60 ? h * 60 + mi : null;
};

/**
 * Today's shift window for a profile with shiftStart/shiftEnd "HH:MM" (local).
 * Overnight shifts (end ≤ start) end on the next local day. Unknown → { known: false }.
 */
export function shiftWindow(profile, { now = Date.now(), tzOffsetMin = DEFAULT_TZ_OFFSET_MIN } = {}) {
  const start = parseHHMM(profile?.shiftStart), end = parseHHMM(profile?.shiftEnd);
  if (start == null || end == null) return { known: false, startAt: null, endAt: null, minutesLeft: null };
  const localNow = now + tzOffsetMin * 60000;
  const dayStartLocal = Math.floor(localNow / 86400000) * 86400000;     // local midnight, expressed in "local ms"
  const minuteOfDay = Math.floor((localNow - dayStartLocal) / 60000);
  let startLocal = dayStartLocal + start * 60000;
  let endLocal = dayStartLocal + end * 60000;
  if (end <= start) {                                                   // overnight
    if (minuteOfDay < end) startLocal -= 86400000; else endLocal += 86400000;
  }
  const toUtc = (ms) => ms - tzOffsetMin * 60000;
  const startAt = toUtc(startLocal), endAt = toUtc(endLocal);
  return { known: true, startAt, endAt, minutesLeft: Math.round((endAt - now) / 60000), startsInMin: Math.round((startAt - now) / 60000), label: `${profile.shiftStart}–${profile.shiftEnd}` };
}

/** Stops still to serve on a route (not collected, not skipped). */
export function pendingRouteStops(route) {
  const done = new Set([...(route?.collectedBinIds || []), ...((route?.skippedStops || []).map((s) => s.binId))]);
  const stops = route?.orderedStops?.length ? route.orderedStops : (route?.binIds || []).map((binId, i) => ({ binId, order: i + 1 }));
  return stops.filter((s) => !done.has(s.binId));
}

/**
 * How long until a route is finished, and where it ends.
 * Straight-line estimate through the pending stops from `from` (driver's live position if known).
 */
export function routeRemaining(route, { from = null } = {}) {
  const pend = pendingRouteStops(route);
  const pts = pend.filter((s) => s.lat != null && s.lng != null);
  let km = 0, prev = from?.lat != null ? from : null;
  for (const p of pts) { if (prev) km += haversineDistanceKm(prev.lat, prev.lng, p.lat, p.lng) ?? 0; prev = p; }
  const driveMin = km > 0 ? estimateTravelMinutes(km) : 0;
  const remainingMin = Math.round(driveMin + pend.length * ASSUMPTIONS.minutesPerStop);
  const last = pts[pts.length - 1] || null;
  return { pendingCount: pend.length, remainingKm: Math.round(km * 10) / 10, remainingMin, endPoint: last ? { lat: last.lat, lng: last.lng, binId: last.binId } : null, source: "estimate" };
}

/**
 * Operational state of one driver.
 * @returns {{state:string,label:string,codes:string[],activeRoutes:object[],currentRoute:object|null,reservedRoute:object|null,
 *            finishInMin:number|null,endPoint:object|null,shift:object,capacityL:number|null,queuedL:number,remainingCapacityL:number|null}}
 */
export function driverOperationalState(profile, { vehicle = null, routes = [], incidents = [], now = Date.now(), tzOffsetMin = DEFAULT_TZ_OFFSET_MIN, fullThresholdL = DEFAULT_FULL_THRESHOLD_L } = {}) {
  const codes = [];
  const shift = shiftWindow(profile, { now, tzOffsetMin });
  const activeRoutes = routes.filter((r) => r.driverId === profile?.uid && ACTIVE_ROUTE_STATUSES.includes(r.status));
  const current = activeRoutes.find((r) => r.status === "in_progress") || null;
  const queued = activeRoutes.filter((r) => r.status === "approved");
  const reservedRoute = current ? queued.find((r) => r.dispatch?.reservedAfterRouteId === current.id) || null : null;
  const capacityL = Number(vehicle?.capacityLiters) || null;
  const queuedL = activeRoutes.reduce((a, r) => a + (Number(r.estimatedWasteLiters) || 0), 0);
  const remainingCapacityL = capacityL != null ? Math.max(0, capacityL - queuedL) : null;
  const breakdown = incidents.some((i) => i.status === "open" && activeRoutes.some((r) => r.id === i.routeId) && /breakdown|vehicle|عطل/.test(String(i.type)));

  if (profile?.accountStatus && profile.accountStatus !== "active") codes.push("ACCOUNT_INACTIVE");
  if (profile?.availability === "unavailable") codes.push("DRIVER_UNAVAILABLE");
  if (profile?.shiftStatus !== "on_shift") codes.push("OFF_SHIFT");
  else if (shift.known && shift.minutesLeft <= 0) codes.push("SHIFT_ENDED");
  if (!profile?.vehicleId) codes.push("NO_VEHICLE");
  else if (!vehicle) codes.push("VEHICLE_MISSING");
  else if (vehicle.status === "maintenance" || vehicle.status === "offline" || breakdown) codes.push("VEHICLE_FAULT");

  let finishInMin = null, endPoint = null;
  if (current) {
    const live = profile?.lastLocation?.lat != null ? profile.lastLocation : null;
    const rem = routeRemaining(current, { from: live });
    finishInMin = rem.remainingMin; endPoint = rem.endPoint;
  }

  let state;
  if (codes.includes("ACCOUNT_INACTIVE") || codes.includes("DRIVER_UNAVAILABLE")) state = DRIVER_STATES.UNAVAILABLE;
  else if (codes.includes("OFF_SHIFT") || codes.includes("SHIFT_ENDED")) state = DRIVER_STATES.OFF_SHIFT;
  else if (codes.includes("VEHICLE_FAULT") || codes.includes("NO_VEHICLE") || codes.includes("VEHICLE_MISSING")) state = DRIVER_STATES.VEHICLE_FAULT;
  else if (remainingCapacityL != null && activeRoutes.length > 0 && remainingCapacityL < fullThresholdL) { state = DRIVER_STATES.VEHICLE_FULL; codes.push("VEHICLE_FULL"); }
  else if (reservedRoute) state = DRIVER_STATES.NEXT_ROUTE_RESERVED;
  else if (activeRoutes.length > 0) state = DRIVER_STATES.ON_ROUTE;
  else state = DRIVER_STATES.AVAILABLE;

  return { state, label: DRIVER_STATE_LABELS[state], codes, activeRoutes, currentRoute: current, queuedRoutes: queued, reservedRoute, finishInMin, endPoint, shift, capacityL, queuedL, remainingCapacityL };
}
