/**
 * fleetEngine.js — Phase 1 of the fleet platform: drivers, vehicles, coverage.
 * ─────────────────────────────────────────────────────────────────────
 * Pure, framework-free rules shared by the admin UI, the driver portal and
 * (mirrored) by firestore.rules. Nothing here touches Firestore or React.
 *
 *   • permissions:      can(role, action, ctx)  — the RBAC matrix (mirrored in firestore.rules)
 *   • assignments:      vehicle ↔ driver shift-window overlap detection
 *   • routes:           "one active route per driver" + vehicle-in-use guards
 *   • coverage:         neighborhoods ↔ drivers lookups, eligible drivers for a neighborhood
 *   • profiles:         driver-code generation + profile validation
 *
 * Phase 2 (assignment engine) and Phase 3 (VRP) build on these helpers; they
 * never re-derive them.
 * ─────────────────────────────────────────────────────────────────────
 */
import { normalizeNeighborhoodName } from "./config";

export const ROLES = ["citizen", "employee", "executive", "driver"];
export const SHIFT_STATUSES = ["off_shift", "on_shift", "break"];
export const AVAILABILITY = ["available", "busy", "unavailable"];
export const ACTIVE_ROUTE_STATUSES = ["approved", "in_progress"];
export const SHIFT_STATUS_LABELS = { off_shift: "خارج المناوبة", on_shift: "في المناوبة", break: "استراحة" };
export const AVAILABILITY_LABELS = { available: "متاح", busy: "مشغول بمهمة", unavailable: "غير متاح" };

// ── RBAC ──────────────────────────────────────────────────────────────
/**
 * Single permission matrix. `ctx` carries ownership facts the rule needs
 * (e.g. is this route assigned to me?). Kept deliberately small and
 * readable so firestore.rules can mirror it line by line.
 */
const MATRIX = {
  "drivers.manage":        (r) => r === "employee" || r === "executive",
  "drivers.view":          (r) => r === "employee" || r === "executive",
  "driver.self.update":    (r, c) => r === "driver" && c.isSelf === true,     // shiftStatus/availability/location only
  "routes.create":         (r) => r === "employee" || r === "executive",
  "routes.approve":        (r) => r === "employee" || r === "executive",
  "routes.assign":         (r) => r === "employee" || r === "executive",
  "routes.view":           (r, c) => r === "employee" || r === "executive" || (r === "driver" && c.assignedToMe === true),
  "routes.execute":        (r, c) => r === "driver" && c.assignedToMe === true, // start/collect/complete
  "incidents.report":      (r, c) => r === "driver" && c.assignedToMe === true,
  "vehicles.manage":       (r) => r === "employee" || r === "executive",
  "fleet.monitor":         (r) => r === "employee" || r === "executive",
  "users.manageRoles":     (r) => r === "executive",
};
export function can(role, action, ctx = {}) {
  const rule = MATRIX[action];
  if (!rule) return false;
  return !!rule(role, ctx);
}
export const PERMISSION_ACTIONS = Object.keys(MATRIX);

// ── Driver profiles ───────────────────────────────────────────────────
/** Deterministic, human-readable driver code from an auth uid: DRV-XXXXXX (never random, never sequential). */
export function driverCodeFor(uid = "") {
  let h = 0;
  for (const ch of String(uid)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return "DRV-" + h.toString(36).toUpperCase().padStart(6, "0").slice(-6);
}

/** Normalizes a profile patch coming from the admin form; returns {ok, errors[], value}. */
export function validateDriverProfile(input = {}, { knownNeighborhoodKeys = [] } = {}) {
  const errors = [];
  const value = {
    fullName: String(input.fullName || "").trim(),
    phone: String(input.phone || "").trim(),
    vehicleId: input.vehicleId || null,
    neighborhoodKeys: [...new Set((input.neighborhoodKeys || []).map(normalizeNeighborhoodName).filter(Boolean))],
    shiftStart: input.shiftStart || null, // "HH:MM" daily window (Phase 1); real shift docs are written on clock-in
    shiftEnd: input.shiftEnd || null,
  };
  if (!value.fullName) errors.push("اسم السائق مطلوب");
  if (value.phone && !/^\+?\d{7,15}$/.test(value.phone.replace(/[\s-]/g, ""))) errors.push("رقم الهاتف غير صالح");
  const unknown = value.neighborhoodKeys.filter((k) => knownNeighborhoodKeys.length > 0 && !knownNeighborhoodKeys.includes(k));
  if (unknown.length) errors.push(`أحياء غير معروفة في حدود المدينة: ${unknown.join("، ")}`);
  if ((value.shiftStart && !value.shiftEnd) || (!value.shiftStart && value.shiftEnd)) errors.push("حدد بداية ونهاية المناوبة معًا");
  if (value.shiftStart && value.shiftEnd && !/^\d{2}:\d{2}$/.test(value.shiftStart + "") ) errors.push("صيغة وقت المناوبة HH:MM");
  return { ok: errors.length === 0, errors, value };
}

// ── Vehicle assignments (time-windowed) ───────────────────────────────
const toMs = (v) => (v == null ? null : typeof v === "number" ? v : new Date(v).getTime());

/** Two [start,end) windows overlap? An open-ended window (end=null) runs forever. */
export function windowsOverlap(a, b) {
  const aS = toMs(a.start) ?? -Infinity, aE = toMs(a.end) ?? Infinity;
  const bS = toMs(b.start) ?? -Infinity, bE = toMs(b.end) ?? Infinity;
  return aS < bE && bS < aE;
}

/**
 * Rejects assigning `vehicleId` to `driverId` for the window when another
 * driver already holds that vehicle in an overlapping window, and when the
 * same driver already holds another vehicle in an overlapping window.
 * @param {{driverId:string, vehicleId:string, start:string|number, end?:string|number|null}} candidate
 * @param {Array<{id?:string, driverId:string, vehicleId:string, start:string, end?:string|null, active?:boolean}>} existing
 */
export function findVehicleAssignmentConflicts(candidate, existing = []) {
  const conflicts = [];
  for (const a of existing) {
    if (a.active === false) continue;
    if (a.id && candidate.id && a.id === candidate.id) continue;
    if (!windowsOverlap(candidate, a)) continue;
    if (a.vehicleId === candidate.vehicleId && a.driverId !== candidate.driverId) {
      conflicts.push({ type: "vehicle_double_booked", assignment: a, message: `المركبة مُسندة لسائق آخر (${a.driverName || a.driverId}) في مناوبة متداخلة` });
    } else if (a.driverId === candidate.driverId && a.vehicleId !== candidate.vehicleId) {
      conflicts.push({ type: "driver_double_vehicle", assignment: a, message: `السائق مُسند لمركبة أخرى (${a.vehicleNumber || a.vehicleId}) في مناوبة متداخلة` });
    }
  }
  return conflicts;
}

/** The assignment in force for a driver at `at` (default now). */
export function activeAssignmentFor(driverId, assignments = [], at = Date.now()) {
  return assignments.find((a) => a.driverId === driverId && a.active !== false && windowsOverlap({ start: at, end: at + 1 }, a)) || null;
}
/** The driver who holds `vehicleId` at `at`. */
export function vehicleHolderAt(vehicleId, assignments = [], at = Date.now()) {
  return assignments.find((a) => a.vehicleId === vehicleId && a.active !== false && windowsOverlap({ start: at, end: at + 1 }, a)) || null;
}

// ── Route ↔ driver guards ─────────────────────────────────────────────
/**
 * A driver may hold at most ONE route in approved/in_progress at a time, and
 * a vehicle may not be on two active routes. Returns the blocking routes.
 */
export function findRouteAssignmentConflicts({ routeId, driverId, vehicleId }, routes = []) {
  const conflicts = [];
  for (const r of routes) {
    if (r.id === routeId || !ACTIVE_ROUTE_STATUSES.includes(r.status)) continue;
    if (driverId && r.driverId === driverId) conflicts.push({ type: "driver_has_active_route", route: r, message: `السائق لديه جولة نشطة بالفعل: ${r.routeName}` });
    else if (vehicleId && r.vehicleId === vehicleId) conflicts.push({ type: "vehicle_on_active_route", route: r, message: `المركبة في جولة نشطة بالفعل: ${r.routeName}` });
  }
  return conflicts;
}

// ── Coverage ──────────────────────────────────────────────────────────
/** Drivers whose coverage includes the neighborhood (by normalized name). */
export function driversCovering(neighborhoodName, profiles = []) {
  const key = normalizeNeighborhoodName(neighborhoodName);
  return profiles.filter((p) => (p.neighborhoodKeys || []).includes(key));
}

/** neighborhoodKey → drivers[] for every key in `neighborhoodKeys` (keys without drivers map to []). */
export function coverageMatrix(neighborhoodKeys = [], profiles = []) {
  const m = {};
  for (const k of neighborhoodKeys) m[k] = [];
  for (const p of profiles) for (const k of p.neighborhoodKeys || []) { if (!(k in m)) m[k] = []; m[k].push(p); }
  return m;
}

/**
 * Phase-1 eligibility (the Phase-2 engine adds travel time/capacity/load):
 * active account, on shift, available, inside coverage, holding a usable vehicle.
 * Returns every driver with a per-driver verdict so the admin sees WHY someone is out.
 */
export function eligibleDriversFor(neighborhoodName, { profiles = [], vehicles = [], routes = [], at = Date.now() } = {}) {
  const key = normalizeNeighborhoodName(neighborhoodName);
  const vehicleById = new Map(vehicles.map((v) => [v.id, v]));
  return profiles.map((p) => {
    const reasons = [];
    if (p.accountStatus && p.accountStatus !== "active") reasons.push("الحساب غير مفعّل");
    if (p.shiftStatus !== "on_shift") reasons.push("خارج المناوبة");
    if (p.availability === "unavailable") reasons.push("غير متاح");
    if (!(p.neighborhoodKeys || []).includes(key)) reasons.push("خارج نطاق التغطية");
    const v = p.vehicleId ? vehicleById.get(p.vehicleId) : null;
    if (!p.vehicleId) reasons.push("لا توجد مركبة مسندة");
    else if (!v) reasons.push("المركبة المسندة غير موجودة");
    else if (v.status === "maintenance" || v.status === "offline") reasons.push(`المركبة ${v.status === "maintenance" ? "في الصيانة" : "غير متصلة"}`);
    const activeRoute = routes.find((r) => ACTIVE_ROUTE_STATUSES.includes(r.status) && r.driverId === p.uid);
    if (activeRoute) reasons.push(`لديه جولة نشطة: ${activeRoute.routeName}`);
    return { profile: p, vehicle: v || null, eligible: reasons.length === 0, reasons, at };
  }).sort((a, b) => Number(b.eligible) - Number(a.eligible));
}

/** Is a stored location fresh enough to show as "live"? (default 5 minutes) */
export function locationFreshness(lastLocation, { now = Date.now(), freshMs = 5 * 60 * 1000 } = {}) {
  if (!lastLocation?.at) return { state: "none", ageMin: null };
  const age = now - new Date(lastLocation.at).getTime();
  return { state: age <= freshMs ? "live" : "stale", ageMin: Math.round(age / 60000) };
}
