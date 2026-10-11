/**
 * executionEngine.js — Phase 5: rules for executing a route in the field.
 * ─────────────────────────────────────────────────────────────────────
 * Pure. The driver portal and firestoreService call these; nothing here
 * writes to Firestore.
 *
 *   • collectionEventId(routeId, binId)   deterministic id → a double tap can
 *                                         never create two events (idempotent set)
 *   • canConfirmCollection(...)           driver ↔ route ↔ bin authorization
 *   • routeProgress(route)                collected / skipped / remaining, kept SEPARATE
 *   • nextStopFor(route)                  first stop neither collected nor skipped
 *   • INCIDENT_TYPES                      obstacle | fault | unreachable (+ labels)
 *   • reinstateSkippedStop(route, binId)  a skipped bin can be put back in the queue
 *
 * The collection event is an OPERATIONAL record: it never edits the sensor's
 * fill reading (that only changes with a new reading from the device).
 * ─────────────────────────────────────────────────────────────────────
 */
import { can } from "./fleetEngine";

export const INCIDENT_TYPES = {
  obstacle:    { label: "يوجد عائق (طريق مغلق)", icon: "🚧", recompute: true },
  fault:       { label: "يوجد عطل (حاوية/مركبة)", icon: "⚠️", recompute: false },
  unreachable: { label: "تعذر الوصول للحاوية",    icon: "⛔", recompute: true },
};

export const collectionEventId = (routeId, binId) => `${routeId}__${binId}`;

/**
 * @returns {{ok:boolean, reason:string}}
 */
export function canConfirmCollection({ user, route, binId }) {
  if (!user || !route) return { ok: false, reason: "بيانات ناقصة" };
  if (!can(user.role || "driver", "routes.execute", { assignedToMe: route.driverId === user.uid })) return { ok: false, reason: "هذه الجولة غير مسندة لك" };
  if (route.status !== "in_progress") return { ok: false, reason: "الجولة ليست نشطة" };
  if (!(route.binIds || []).includes(binId) && !(route.orderedStops || []).some((s) => s.binId === binId)) return { ok: false, reason: "الحاوية ليست ضمن هذه الجولة" };
  if ((route.collectedBinIds || []).includes(binId)) return { ok: false, reason: "تم تأكيد تفريغ هذه الحاوية مسبقًا" };
  return { ok: true, reason: "" };
}

/** Collected and skipped are disjoint sets; a bin is "remaining" if in neither. */
export function routeProgress(route) {
  const stops = (route?.orderedStops || []).filter((s) => s.binId);
  const collected = new Set(route?.collectedBinIds || []);
  const skipped = new Map((route?.skippedStops || []).map((s) => [s.binId, s]));
  const remaining = stops.filter((s) => !collected.has(s.binId) && !skipped.has(s.binId));
  return {
    total: stops.length,
    collected: stops.filter((s) => collected.has(s.binId)).length,
    skipped: stops.filter((s) => skipped.has(s.binId)).length,
    remaining: remaining.length,
    remainingStops: remaining,
    pct: stops.length ? Math.round((stops.filter((s) => collected.has(s.binId)).length / stops.length) * 100) : 0,
    done: remaining.length === 0,
  };
}

export function nextStopFor(route) {
  const p = routeProgress(route);
  return p.remainingStops.find((s) => !s.deferred) || p.remainingStops[0] || null;
}

/** Build the skippedStops entry for an incident (kept on the route so the stop is never silently "completed"). */
export function skipEntry({ binId, type, incidentId, note = "", at = new Date().toISOString() }) {
  if (!INCIDENT_TYPES[type]) throw new Error("نوع بلاغ غير معروف");
  return { binId, reason: type, incidentId: incidentId || null, note, at };
}

/** Remove a bin from skippedStops so it returns to the remaining queue (admin or driver re-attempt). */
export function reinstateSkippedStop(route, binId) {
  return { skippedStops: (route?.skippedStops || []).filter((s) => s.binId !== binId) };
}

/** Confirmation payload — includes where/when it was confirmed and GPS accuracy if known. */
export function buildConfirmation({ route, bin, user, position, now = new Date().toISOString() }) {
  return {
    id: collectionEventId(route.id, bin.id),
    binId: bin.id, routeId: route.id, vehicleId: route.vehicleId || null, operatorId: user.uid, driverId: user.uid, driverName: user.name || "",
    fillBefore: Number(bin.lastFillLevelPercent) || 0, // last MEASURED value — a label, not a new reading
    demo: !!(bin.demo || bin.simulated),                // events on simulated bins are demo rows (cleanable); real ones are immutable
    fillAfter: null,                                    // unknown until the sensor reports again (never fabricated)
    source: "route", confirmedAt: now,
    confirmLocation: position?.lat != null ? { lat: position.lat, lng: position.lng, accuracyM: position.accuracy ?? null, source: position.source || "gps" } : null,
    distanceToBinM: position?.lat != null && bin.lat != null ? Math.round(Math.hypot((position.lat - bin.lat) * 111320, (position.lng - bin.lng) * 111320 * Math.cos((bin.lat * Math.PI) / 180))) : null,
  };
}
