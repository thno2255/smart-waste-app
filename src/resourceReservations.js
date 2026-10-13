/**
 * resourceReservations.js — time-window reservations of drivers and vehicles.
 * ─────────────────────────────────────────────────────────────────────
 * A loan (or any adjustment that takes a resource away from its plan) holds the
 * resource for a WINDOW: departure → arrival → task → return. Two reservations
 * of the same resource conflict when their windows overlap. The check is run on
 * the whole SET of recommendations (group consistency) and again, atomically,
 * by the server when one is approved. Pure module.
 * ─────────────────────────────────────────────────────────────────────
 */
export const RESERVATION_STATUSES = ["active", "released", "cancelled"];

const t = (v) => (v == null ? null : typeof v === "number" ? v : new Date(v).getTime());

/** [aStart,aEnd) and [bStart,bEnd) overlap. A missing end is open-ended (conservative). */
export function windowsOverlap(a, b) {
  const as = t(a.startAt), ae = t(a.endAt) ?? Infinity, bs = t(b.startAt), be = t(b.endAt) ?? Infinity;
  if (as == null || bs == null) return true; // unknown start → cannot prove they are disjoint
  return as < be && bs < ae;
}

/**
 * Loan window for a resource travelling `travelMin` each way and working `taskMin` at the receiver.
 * @returns {{startAt:string, arriveAt:string, workEndAt:string, endAt:string, travelMin:number, taskMin:number}}
 */
export function loanWindow({ now = Date.now(), travelMin, taskMin }) {
  const tm = Math.max(0, Math.round(travelMin || 0)), wk = Math.max(0, Math.round(taskMin || 0));
  const iso = (ms) => new Date(ms).toISOString();
  return { startAt: iso(now), arriveAt: iso(now + tm * 60000), workEndAt: iso(now + (tm + wk) * 60000), endAt: iso(now + (2 * tm + wk) * 60000), travelMin: tm, taskMin: wk };
}

/**
 * Conflicts inside a set of reservations (and against existing active ones).
 * @param {Array<{id?, resourceIds:string[], startAt, endAt}>} proposed
 * @param {Array<{resourceId:string, startAt, endAt, status?:string, id?}>} existing
 * @returns {Array<{a, b, resourceId}>}
 */
export function findReservationConflicts(proposed = [], existing = []) {
  const out = [];
  const flat = proposed.flatMap((p, i) => (p.resourceIds || []).filter(Boolean).map((resourceId) => ({ ...p, resourceId, _i: i })));
  for (let i = 0; i < flat.length; i++) {
    for (let j = i + 1; j < flat.length; j++) {
      if (flat[i]._i !== flat[j]._i && flat[i].resourceId === flat[j].resourceId && windowsOverlap(flat[i], flat[j])) out.push({ a: flat[i].id ?? flat[i]._i, b: flat[j].id ?? flat[j]._i, resourceId: flat[i].resourceId });
    }
    for (const e of existing) {
      if ((e.status || "active") === "active" && e.resourceId === flat[i].resourceId && windowsOverlap(flat[i], e)) out.push({ a: flat[i].id ?? flat[i]._i, b: e.id || "existing", resourceId: e.resourceId });
    }
  }
  return out;
}

/** True when `resourceId` is free for the whole window, given active reservations. */
export function isFree(resourceId, window, existing = []) {
  return !existing.some((e) => (e.status || "active") === "active" && e.resourceId === resourceId && windowsOverlap(window, e));
}
