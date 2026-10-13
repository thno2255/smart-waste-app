/**
 * executionOutcome.js — has a decision actually been carried out?
 * ─────────────────────────────────────────────────────────────────────
 * A decision covers a SET of bins on ONE route (decision.routeId + decision.binIds).
 * Its execution is read only from server-verified collection events
 * (collection_events, id routeId__binId) for THOSE bins on THAT route — an
 * event for another route, or for a bin outside the decision, never counts.
 *
 * States (one per decision):
 *   NOT_STARTED        route approved, nothing collected yet, route not started
 *   STARTED            route in progress, none of the decision's bins collected yet
 *   PARTIAL            some — not all — of the decision's bins collected
 *   DELAYED            not complete and the deadline has passed (route still open)
 *   COMPLETED_ON_TIME  every bin collected, last one by the deadline
 *   COMPLETED_LATE     every bin collected, last one after the deadline
 *   COMPLETED          every bin collected, no deadline recorded to judge it
 *   FAILED             the route ended / was withdrawn with bins left uncollected and none collected,
 *                      or every remaining bin was skipped with an incident
 *   UNKNOWN            the route record is missing
 * A decision with several bins is never "completed" after one collection.
 * Pure module.
 * ─────────────────────────────────────────────────────────────────────
 */
export const EXECUTION_STATES = ["NOT_STARTED", "STARTED", "PARTIAL", "DELAYED", "COMPLETED_ON_TIME", "COMPLETED_LATE", "COMPLETED", "FAILED", "UNKNOWN"];
export const EXECUTION_STATE_TEXT = {
  NOT_STARTED: "لم يبدأ التنفيذ",
  STARTED: "بدأ التنفيذ",
  PARTIAL: "تنفيذ جزئي",
  DELAYED: "تأخر التنفيذ",
  COMPLETED_ON_TIME: "اكتمل ضمن المهلة",
  COMPLETED_LATE: "اكتمل متأخرًا",
  COMPLETED: "اكتمل التنفيذ",
  FAILED: "تعذر التنفيذ",
  UNKNOWN: "غير معروف",
};
export const COMPLETED_STATES = ["COMPLETED_ON_TIME", "COMPLETED_LATE", "COMPLETED"];
const ENDED_ROUTE = ["completed", "withdrawn", "cancelled", "rejected"];

const ms = (iso) => { if (!iso) return null; const t = new Date(iso).getTime(); return Number.isFinite(t) ? t : null; };

/**
 * Deadline of a decision: an urgent decision must be collected within the critical target from the
 * moment it was taken; otherwise the expected completion the engine recorded. Null when neither is known.
 */
export function decisionDeadline(decision, { criticalCollectionMin = null } = {}) {
  const decidedAt = ms(decision.executedAt || decision.createdAt || decision.explanation?.decidedAt);
  if (decision.urgent && criticalCollectionMin != null && decidedAt != null) return decidedAt + criticalCollectionMin * 60000;
  return ms(decision.expectedCollectionAt);
}

/**
 * @param {object} decision  dispatch decision {routeId, binIds, urgent, expectedCollectionAt, executedAt|createdAt}
 * @param {{routes:Array, events:Array, now?:number, criticalCollectionMin?:number}} ctx
 */
export function decisionExecution(decision, { routes = [], events = [], now = Date.now(), criticalCollectionMin = null } = {}) {
  const binIds = [...new Set(decision.binIds || [])];
  const route = routes.find((r) => r.id === decision.routeId) || null;
  const total = binIds.length;
  if (!route || total === 0) return { state: "UNKNOWN", total, collected: 0, skipped: 0, remaining: total, deadlineAt: null, lastCollectedAt: null, reason: !route ? "سجل الجولة غير موجود" : "القرار بلا حاويات" };
  const ids = new Set(binIds);
  // Only events of THIS route for THIS decision's bins (server-verified, one per routeId__binId).
  const mine = events.filter((e) => e.routeId === route.id && ids.has(e.binId));
  const collectedAt = new Map();
  for (const e of mine) { const t = ms(e.confirmedAt || e.collectedAt); if (t != null && (!collectedAt.has(e.binId) || t < collectedAt.get(e.binId))) collectedAt.set(e.binId, t); }
  const skippedIds = new Set((route.skippedStops || []).map((s) => s.binId).filter((id) => ids.has(id) && !collectedAt.has(id)));
  const collected = collectedAt.size, skipped = skippedIds.size, remaining = total - collected - skipped;
  const deadline = decisionDeadline(decision, { criticalCollectionMin });
  const last = collected ? Math.max(...collectedAt.values()) : null;
  const base = { total, collected, skipped, remaining, deadlineAt: deadline != null ? new Date(deadline).toISOString() : null, lastCollectedAt: last != null ? new Date(last).toISOString() : null, routeStatus: route.status };

  if (collected === total) {
    if (deadline == null) return { ...base, state: "COMPLETED" };
    return { ...base, state: last <= deadline ? "COMPLETED_ON_TIME" : "COMPLETED_LATE" };
  }
  const ended = ENDED_ROUTE.includes(route.status) || (route.status === "suggested" && decision.status === "executed");
  if (remaining === 0 || ended) {
    // Nothing left to do on this route for the decision, and it is not complete.
    if (collected === 0) return { ...base, state: "FAILED", reason: skipped ? "تُخطّيت الحاويات ببلاغ" : `انتهت الجولة (${route.status}) دون جمع حاويات القرار` };
    return { ...base, state: "PARTIAL", final: true, reason: `جُمعت ${collected} من ${total}` };
  }
  if (deadline != null && now > deadline) return { ...base, state: "DELAYED" };
  if (collected > 0) return { ...base, state: "PARTIAL", final: false };
  return { ...base, state: route.status === "in_progress" ? "STARTED" : "NOT_STARTED" };
}

/** Counts by state for a set of executed decisions. */
export function summarizeExecutions(decisions, ctx) {
  const byState = Object.fromEntries(EXECUTION_STATES.map((s) => [s, 0]));
  const rows = decisions.map((d) => { const x = decisionExecution(d, ctx); byState[x.state] += 1; return { decisionId: d.id || d.key, ...x }; });
  const completed = COMPLETED_STATES.reduce((a, s) => a + byState[s], 0);
  return { total: decisions.length, completed, onTime: byState.COMPLETED_ON_TIME, byState, rows };
}
