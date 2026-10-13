/**
 * adjustmentOutcome.js — from an approved adjustment to its measured result (pure).
 * ─────────────────────────────────────────────────────────────────────
 * Expected (stored at approval) vs. realised (from routes and server-verified
 * collection events). Approval is not execution: the adjustment is EXECUTED only
 * when every bin it planned was collected on the route it planned; it is FAILED when
 * its routes ended without that. Distance and money are never inferred from the plan:
 * without GPS / odometer / recorded costs they are reported as not available.
 * ─────────────────────────────────────────────────────────────────────
 */
import { decisionExecution, COMPLETED_STATES } from "./executionOutcome.js";

export const ADJUSTMENT_STATUSES = ["SIMULATED", "PROPOSED", "APPROVED", "EXECUTED", "REJECTED", "FAILED", "STALE"];
export const ADJUSTMENT_STATUS_TEXT = { SIMULATED: "نتيجة محاكاة", PROPOSED: "توصية مقترحة", APPROVED: "معتمدة", EXECUTED: "نُفذت فعليًا", REJECTED: "مرفوضة", FAILED: "تعذر تنفيذها", STALE: "تجاوزتها الظروف" };

/**
 * @param {object} a  adjustment_analyses document (status APPROVED|EXECUTED|FAILED, applied, expected)
 * @param {{routes:Array, events:Array, now:number, criticalCollectionMin?:number}} ctx
 */
export function adjustmentOutcome(a, { routes = [], events = [], now = Date.now(), criticalCollectionMin = null } = {}) {
  const applied = a.applied || {};
  const work = [...(applied.createdRoutes || []), ...(applied.modifiedRoutes || [])].filter((w) => (w.binIds || []).length);
  const deadline = a.expected?.completionAt || null;
  const rows = work.map((w) => ({ routeId: w.routeId, ...decisionExecution({ routeId: w.routeId, binIds: w.binIds, urgent: false, expectedCollectionAt: deadline, executedAt: a.approvedAt }, { routes, events, now, criticalCollectionMin }) }));
  const planned = rows.reduce((x, r) => x + r.total, 0);
  const collected = rows.reduce((x, r) => x + r.collected, 0);
  const skipped = rows.reduce((x, r) => x + r.skipped, 0);
  const late = rows.filter((r) => ["COMPLETED_LATE", "DELAYED"].includes(r.state)).length;
  const done = rows.length > 0 && rows.every((r) => COMPLETED_STATES.includes(r.state));
  const failed = rows.length > 0 && rows.every((r) => r.state === "FAILED");
  const ended = rows.length > 0 && rows.every((r) => ["COMPLETED_ON_TIME", "COMPLETED_LATE", "COMPLETED", "FAILED"].includes(r.state) || (r.state === "PARTIAL" && r.final));
  const routesCompleted = rows.filter((r) => COMPLETED_STATES.includes(r.state)).length;
  const pendingExternal = (applied.externalRequests || []).length + (applied.loans || []).filter((l) => !l.executed).length;
  const state = rows.length === 0 ? (pendingExternal ? "AWAITING_EXTERNAL" : "NO_TRACKED_WORK") : done ? "EXECUTED" : failed ? "FAILED" : ended ? "PARTIAL_FINAL" : collected > 0 ? "IN_PROGRESS" : "NOT_STARTED";
  return {
    state, routes: rows, routesPlanned: rows.length, routesCompleted, binsPlanned: planned, binsCollected: collected, binsSkipped: skipped,
    unfinishedBins: ended ? planned - collected : null, lateRoutes: late,
    expected: a.expected || null,
    realised: {
      distanceKm: null, distanceText: "المسافة الفعلية غير متاحة — لا تسجيل GPS أو عداد للجولات",
      saving: null, savingText: "الوفر الفعلي غير متاح",
      extraCost: null, extraCostText: "التكلفة الفعلية غير متاحة — لا تكاليف مسجلة",
      nextDays: null, nextDaysText: "أثر التعديل على الأيام التالية غير مقاس بعد",
    },
    pendingExternal, measuredAt: new Date(now).toISOString(),
    finalStatus: state === "EXECUTED" ? "EXECUTED" : state === "FAILED" ? "FAILED" : null,
  };
}
