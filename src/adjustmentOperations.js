/**
 * adjustmentOperations.js — what approving an adjustment changes in the plan (pure).
 * ─────────────────────────────────────────────────────────────────────
 * From an evaluated alternative (minimumOperationalAdjustmentEngine) to a list of
 * operations the server applies in ONE transaction after re-checking each one:
 *   UPDATE_ROUTE_STOPS  a committed route gets a new pending order / loses or gains bins
 *   CREATE_ROUTE        new work for a crew (now, at its shift start, or after its current route)
 *   LINK_VEHICLE        an idle vehicle is linked to a driver blocked by theirs
 *   RESERVE_LOAN        an inter-municipality loan: transfer approved + resources reserved for the window
 *                       (the lent crew's route is created by dispatch once the transfer is executed)
 *   EXTERNAL_REQUEST    an extra crew: recorded as a request; nothing is created that does not exist
 * Each operation carries what the server must find unchanged (expected*) — otherwise the approval is refused.
 * ─────────────────────────────────────────────────────────────────────
 */
import { pendingRouteStops } from "./driverState.js";

const iso = (ms) => new Date(ms).toISOString();

/**
 * @param {object} alt     evaluated alternative (stripped) with diff, plan, crews, interventions
 * @param {object} state   the municipality snapshot the alternative was evaluated on
 * @param {object} p       { now, analysisId }
 */
export function buildAdjustmentOperations(alt, state, { now = Date.now(), analysisId = "x" } = {}) {
  const binById = new Map((state.bins || []).map((b) => [b.id, b]));
  const routeById = new Map((state.routes || []).map((r) => [r.id, r]));
  const stopOf = (binId, route = null) => {
    const b = binById.get(binId); const old = (route?.orderedStops || []).find((s) => s.binId === binId);
    return { binId, binName: b?.name || old?.binName || binId, lat: b?.lat ?? old?.lat ?? null, lng: b?.lng ?? old?.lng ?? null, hasCoords: (b?.lat ?? old?.lat) != null, fillLevelPercent: b?.lastFillLevelPercent ?? old?.fillLevelPercent ?? null, wasteLiters: b ? Math.round((Number(b.capacityLiters) || 1100) * Math.min(100, Number(b.lastFillLevelPercent) || 0) / 100) : null };
  };
  const ops = [];
  // 1. committed routes that change
  for (const ch of alt.diff.routeChanges) {
    const r = routeById.get(ch.routeId); if (!r) continue;
    const collected = (r.orderedStops || []).filter((s) => (r.collectedBinIds || []).includes(s.binId) || (r.skippedStops || []).some((x) => x.binId === s.binId));
    const ordered = [...collected, ...ch.binIds.map((id) => stopOf(id, r))].map((s, i) => ({ ...s, order: i + 1 }));
    ops.push({ op: "UPDATE_ROUTE_STOPS", routeId: r.id, routeName: r.routeName || r.id, driverId: r.driverId || null, expectedStatus: r.status, expectedPending: pendingRouteStops(r).map((s) => s.binId),
      orderedStops: ordered, binIds: ordered.map((s) => s.binId), added: ch.added, removed: ch.removed, reordered: ch.reordered });
  }
  // 2. new work
  const loanCrews = new Set(alt.interventions.filter((i) => i.code === "LOAN").map((i) => i.details.driverId));
  let n = 0;
  for (const nr of alt.diff.newRoutes) {
    const crew = alt.crews?.[nr.crewId] || {};
    if (nr.simulated || nr.crewId === "virtual-crew") { ops.push({ op: "EXTERNAL_REQUEST", kind: "EXTRA_CREW", binIds: nr.binIds, note: "طاقم إضافي — يتطلب توفير موارد خارج النظام؛ لا تُنشأ جولة لطاقم غير موجود" }); continue; }
    if (loanCrews.has(nr.crewId)) continue; // handled by RESERVE_LOAN
    const nbs = [...new Set(nr.binIds.map((id) => binById.get(id)?.neighborhoodId).filter(Boolean))];
    const stops = nr.binIds.map((id, i) => ({ ...stopOf(id), order: i + 1 }));
    const after = (crew.commitments || []).slice(-1)[0] || null;
    ops.push({ op: "CREATE_ROUTE", routeId: `adj_${analysisId}_${++n}`, driverId: crew.driverId || nr.crewId, driverName: crew.driverName || nr.driverName, vehicleId: crew.vehicleId || null, vehicleNumber: crew.vehicleNumber || null,
      binIds: stops.map((s) => s.binId), orderedStops: stops, neighborhoodIds: nbs, startAfterMin: crew.availableAtMin || 0, scheduledStartAt: crew.availableAtMin ? iso(now + crew.availableAtMin * 60000) : null,
      reservedAfterRouteId: after, expectedCommitments: crew.commitments || [], estimatedWasteLiters: stops.reduce((a, s) => a + (s.wasteLiters || 0), 0) });
  }
  // 3. resource changes
  for (const i of alt.interventions) {
    if (i.code === "IDLE_VEHICLE") ops.push({ op: "LINK_VEHICLE", driverId: i.details.driverId, vehicleId: i.details.vehicleId, vehicleNumber: i.details.vehicleNumber });
    if (i.code === "LOAN") {
      const work = alt.diff.newRoutes.find((r) => r.crewId === i.details.driverId);
      ops.push({ op: "RESERVE_LOAN", driverId: i.details.driverId, driverName: i.details.driverName, vehicleId: i.details.vehicleId || null, vehicleNumber: i.details.vehicleNumber || null,
        fromMunicipalityId: i.details.fromMunicipalityId, toMunicipalityId: state.municipalityId, window: i.details.window, travelMin: i.details.travelMin, binIds: work?.binIds || [] });
    }
  }
  return ops;
}

/** Resource ids an operation list touches (for per-resource locks). */
export const resourcesOf = (ops) => [...new Set(ops.flatMap((o) => [o.driverId, o.vehicleId].filter(Boolean)))];
