// Minimum operational adjustment — server side (firebase-admin).
//   analyze  : one snapshot of the municipality (+ the other municipalities as potential lenders), the pure engine,
//              the result stored in adjustment_analyses (status SIMULATED or PROPOSED). Nothing changes in the plan.
//   approve  : identity, role, municipality scope, authority of the chosen alternative, age of the analysis,
//              a NEW snapshot with the same fingerprint, the alternative re-verified on it, then ONE transaction that
//              re-reads every route / driver / vehicle / reservation it touches, refuses if anything changed, applies
//              the operations, and records the approval (APPROVED — not executed) with an audit entry. Idempotent.
//   reject   : PROPOSED → REJECTED with a note.
//   sync     : APPROVED adjustments → EXECUTED / FAILED from server-verified collection events.
// The client never sends a plan, a cost or a route: only ids. Everything is recomputed here.
import { analyzeMinimumAdjustment, verifyAdjustmentSet, adjustmentSummary, ROLE_RANK, AUTHORITY_TEXT } from "../../src/minimumOperationalAdjustmentEngine.js";
import { buildAdjustmentOperations, resourcesOf } from "../../src/adjustmentOperations.js";
import { adjustmentOutcome } from "../../src/adjustmentOutcome.js";
import { pendingRouteStops } from "../../src/driverState.js";
import { windowsOverlap } from "../../src/resourceReservations.js";
import { targetsOf } from "../../src/autoDispatchEngine.js";
import { loadMunicipalityState, readDispatchSettings, municipalityIds } from "./dispatchRunner.mjs";
import { iso } from "./http.mjs";
import { fetchRoadMatrix } from "../../src/roadMatrix.js";
import { driverOrigin } from "../../src/assignmentEngine.js";

export class AdjustmentError extends Error { constructor(httpStatus, message, code = null) { super(message); this.httpStatus = httpStatus; this.reasonCode = code; } }

/** Approval must happen within this many minutes of the analysis, on an unchanged state. */
export const MAX_ANALYSIS_AGE_MIN = 15;
const ACTIVE = ["approved", "in_progress"];
const docs = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));
const clean = (x) => JSON.parse(JSON.stringify(x)); // Firestore rejects undefined
const nameOf = async (db, mid) => { const s = await db.collection("municipalities").doc(mid).get().catch(() => null); return s?.exists ? (s.get("shortAr") || s.get("nameAr") || mid) : mid; };

/** Road-network times for the receiver's points (crew origins, depots, likely-due bins). Failure → labelled estimate. */
async function roadMatrixFor(state, settings, now, roadMatrix) {
  if (settings.useRoadNetwork === false) return { matrix: null, routingStatus: "skipped" };
  const pts = [];
  for (const p of state.profiles || []) { const v = (state.vehicles || []).find((x) => x.id === p.vehicleId); const o = driverOrigin(p, v, { now, fallback: null }); if (o) pts.push({ id: `origin:${p.uid}`, lat: o.lat, lng: o.lng }); }
  for (const v of state.vehicles || []) if (v.depotLat != null) pts.push({ id: `depot:${v.id}`, lat: v.depotLat, lng: v.depotLng });
  for (const b of state.bins || []) if (b.lat != null && Number(b.lastFillLevelPercent) >= 60 && Number(b.lastFillLevelPercent) <= 100) pts.push({ id: b.id, lat: b.lat, lng: b.lng });
  const use = pts.slice(0, 60);
  if (use.length < 2) return { matrix: null, routingStatus: "skipped" };
  let m = null;
  try { m = await roadMatrix(use); } catch { m = null; }
  return m?.durations ? { matrix: { ids: use.map((p) => p.id), ...m }, routingStatus: "ok" } : { matrix: null, routingStatus: "failed" };
}

async function context(db, mid, now, roadMatrix = fetchRoadMatrix) {
  const settings = await readDispatchSettings(db);
  const state = await loadMunicipalityState(db, mid, now);
  const others = (await municipalityIds(db)).filter((x) => x !== mid);
  const donors = await Promise.all(others.map(async (id) => ({ municipalityId: id, name: await nameOf(db, id), state: await loadMunicipalityState(db, id, now) })));
  const existingReservations = docs(await db.collection("resource_reservations").where("status", "==", "active").get());
  const road = await roadMatrixFor(state, settings, now, roadMatrix);
  return { settings, state, donors: donors.filter((d) => (d.state.profiles || []).length), existingReservations, policy: settings.adjustmentPolicy || {}, ...road };
}

const roleScope = (user, mid) => {
  if (!["executive", "manager", "employee"].includes(user.role)) throw new AdjustmentError(403, "غير مسموح");
  if (user.role !== "executive" && user.municipalityId !== mid) throw new AdjustmentError(403, "خارج نطاق بلديتك");
};

/** Analyze and store. Returns { id, result }. */
export async function analyzeAdjustment(db, { user, municipalityId, now = Date.now(), roadMatrix = fetchRoadMatrix }) {
  const mid = municipalityId || user.municipalityId;
  if (!mid) throw new AdjustmentError(400, "البلدية مطلوبة");
  roleScope(user, mid);
  const ctx = await context(db, mid, now, roadMatrix);
  if (ctx.state.bins.length === 0) throw new AdjustmentError(404, "لا حاويات في البلدية");
  const r = analyzeMinimumAdjustment(ctx.state, { now, settings: ctx.settings, policy: ctx.policy, donors: ctx.donors, existingReservations: ctx.existingReservations, matrix: ctx.matrix, routingStatus: ctx.routingStatus });
  const ref = db.collection("adjustment_analyses").doc();
  const status = r.status === "RECOMMENDATION" ? "PROPOSED" : "SIMULATED";
  await ref.set(clean({
    municipalityId: mid, status, analysisStatus: r.status, fingerprint: r.fingerprint, policyVersion: r.policyVersion, engineVersion: r.engineVersion, feasibilityVersion: r.feasibilityVersion,
    routingStatus: ctx.routingStatus, createdAt: iso(now), expiresAt: iso(now + MAX_ANALYSIS_AGE_MIN * 60000), createdBy: user.uid, createdByName: user.name || "",
    summary: adjustmentSummary(r), deficit: r.deficit || null, ifNotAdopted: r.ifNotAdopted || null, search: r.search || null, costModel: r.costModel || null, dataQuality: r.dataQuality || [], simulatedEnvironment: !!r.simulatedEnvironment,
    recommendedId: r.recommended?.id || null, alternatives: (r.alternatives || []).map(trimAlt), rejectedCandidates: r.rejectedCandidates || [], explanation: r.explanation || null,
    base: r.base ? { feasibilityStatus: r.base.feasibilityStatus, cause: r.base.cause, unservedBins: r.base.unservedBins, lateBins: r.base.lateBins, plan: r.base.plan, completionMin: r.base.completionMin, travel: r.base.travel, missingData: r.base.missingData, confidenceOrQualityFlags: r.base.confidenceOrQualityFlags } : null,
    error: r.error || null,
  }));
  await syncAdjustmentOutcomes(db, mid, now).catch(() => {});
  return { id: ref.id, status, result: r };
}
// Keep what the UI and the approval need; drop the per-bin times map.
const trimAlt = ({ times, ...rest }) => rest;

/** Approve one SUCCESSFUL alternative of an analysis. */
export async function approveAdjustment(db, { user, analysisId, alternativeId, now = Date.now(), roadMatrix = fetchRoadMatrix }) {
  const aRef = db.collection("adjustment_analyses").doc(analysisId);
  const snap = await aRef.get();
  if (!snap.exists) throw new AdjustmentError(404, "التحليل غير موجود");
  const a = snap.data();
  roleScope(user, a.municipalityId);
  if (a.status === "APPROVED" || a.status === "EXECUTED") {
    if (a.approvedAlternativeId === alternativeId) return { already: true, status: a.status };
    throw new AdjustmentError(409, "اعتُمد بديل آخر لهذا التحليل");
  }
  if (a.status !== "PROPOSED" && a.status !== "SIMULATED") throw new AdjustmentError(409, `لا يمكن اعتماد تحليل حالته ${a.status}`);
  const alt = (a.alternatives || []).find((x) => x.id === alternativeId);
  if (!alt || !alt.success) throw new AdjustmentError(409, "البديل غير موجود أو لا يحقق مستوى الخدمة");
  if ((ROLE_RANK[user.role] || 0) < (ROLE_RANK[alt.authority] || 99)) throw new AdjustmentError(403, `اعتماد هذا البديل من صلاحية ${AUTHORITY_TEXT[alt.authority] || alt.authority}`);
  if (now > new Date(a.expiresAt).getTime()) { await aRef.update({ status: "STALE", staleReason: "انتهت صلاحية التحليل", updatedAt: iso(now) }); throw new AdjustmentError(409, "انتهت صلاحية التحليل — أعد التحليل", "STALE"); }

  // Fresh snapshot: same inputs, and the alternative still valid on them.
  const ctx = await context(db, a.municipalityId, now, roadMatrix);
  const check = verifyAdjustmentSet(ctx.state, alternativeId, { now, settings: ctx.settings, policy: ctx.policy, donors: ctx.donors, existingReservations: ctx.existingReservations, matrix: ctx.matrix, routingStatus: ctx.routingStatus });
  if (check.fingerprint !== a.fingerprint || !check.ok) {
    await aRef.update({ status: "STALE", staleReason: check.fingerprint !== a.fingerprint ? "تغيرت حالة الحاويات أو الجولات أو الموارد منذ التحليل" : check.reason, updatedAt: iso(now) });
    throw new AdjustmentError(409, check.fingerprint !== a.fingerprint ? "تغيرت الظروف منذ التحليل — أعد التحليل قبل الاعتماد" : `${check.reason} — أعد التحليل`, "STALE");
  }
  const ops = buildAdjustmentOperations(check.alternative, ctx.state, { now, analysisId });
  const T = targetsOf(ctx.settings);
  const lockRef = db.collection("dispatch_locks").doc(a.municipalityId);
  const resLocks = resourcesOf(ops).map((id) => db.collection("resource_locks").doc(id));

  return db.runTransaction(async (t) => {
    // ── reads ──
    const cur = await t.get(aRef);
    if (["APPROVED", "EXECUTED"].includes(cur.get("status"))) {
      if (cur.get("approvedAlternativeId") === alternativeId) return { already: true, status: cur.get("status") };
      throw new AdjustmentError(409, "اعتُمد بديل آخر لهذا التحليل");
    }
    if (!["PROPOSED", "SIMULATED"].includes(cur.get("status"))) throw new AdjustmentError(409, "تغيرت حالة التحليل");
    await t.get(lockRef);
    if (resLocks.length) await t.getAll(...resLocks);
    const routeReads = ops.filter((o) => o.op === "UPDATE_ROUTE_STOPS").map((o) => db.collection("collection_routes").doc(o.routeId));
    const routeSnaps = routeReads.length ? await t.getAll(...routeReads) : [];
    const drivers = [...new Set(ops.filter((o) => ["CREATE_ROUTE", "LINK_VEHICLE"].includes(o.op)).map((o) => o.driverId))];
    const vehicles = [...new Set(ops.filter((o) => ["CREATE_ROUTE", "LINK_VEHICLE"].includes(o.op)).map((o) => o.vehicleId).filter(Boolean))];
    const profSnaps = drivers.length ? await t.getAll(...drivers.map((id) => db.collection("driver_profiles").doc(id))) : [];
    const vehSnaps = vehicles.length ? await t.getAll(...vehicles.map((id) => db.collection("vehicles").doc(id))) : [];
    const activeByDriver = {};
    for (const d of drivers) activeByDriver[d] = docs(await t.get(db.collection("collection_routes").where("driverId", "==", d).where("status", "in", ACTIVE)));
    const loanOps = ops.filter((o) => o.op === "RESERVE_LOAN");
    const loanRes = [];
    for (const o of loanOps) for (const rid of [o.driverId, o.vehicleId].filter(Boolean)) loanRes.push(...docs(await t.get(db.collection("resource_reservations").where("resourceId", "==", rid).where("status", "==", "active"))));
    // ── re-validation: nothing the plan relies on may have changed ──
    routeSnaps.forEach((rs, i) => {
      const o = ops.filter((x) => x.op === "UPDATE_ROUTE_STOPS")[i];
      if (!rs.exists) throw new AdjustmentError(409, `الجولة ${o.routeName} لم تعد موجودة`, "STALE");
      const r = { id: rs.id, ...rs.data() };
      if (r.status !== o.expectedStatus || pendingRouteStops(r).map((s) => s.binId).join() !== o.expectedPending.join()) throw new AdjustmentError(409, `تغيرت الجولة ${o.routeName} منذ التحليل`, "STALE");
    });
    for (const ps of profSnaps) {
      if (!ps.exists) throw new AdjustmentError(409, "ملف سائق غير موجود", "STALE");
      const p = ps.data();
      if ((p.accountStatus && p.accountStatus !== "active") || p.availability === "unavailable" || p.municipalityId !== a.municipalityId) throw new AdjustmentError(409, `تغيرت حالة السائق ${p.fullName || ps.id}`, "STALE");
      const op = ops.find((o) => o.op === "CREATE_ROUTE" && o.driverId === ps.id);
      if (op) {
        const now_ = activeByDriver[ps.id].map((r) => r.id).sort().join();
        if (now_ !== [...op.expectedCommitments].sort().join()) throw new AdjustmentError(409, `تغيرت التزامات السائق ${p.fullName || ps.id} منذ التحليل`, "STALE");
        if (!op.scheduledStartAt && p.shiftStatus !== "on_shift") throw new AdjustmentError(409, `السائق ${p.fullName || ps.id} خارج المناوبة`, "STALE");
        const v = vehSnaps.find((x) => x.id === op.vehicleId);
        if (!v?.exists || v.get("capacityLiters") == null) throw new AdjustmentError(409, "سعة مركبة الجولة غير مسجلة — لا يُعتمد عمل لا يمكن إثبات سعته", "STALE");
      }
    }
    for (const vs of vehSnaps) {
      if (!vs.exists) throw new AdjustmentError(409, "مركبة غير موجودة", "STALE");
      if (["maintenance", "offline"].includes(vs.get("status"))) throw new AdjustmentError(409, `المركبة ${vs.get("vehicleNumber") || vs.id} لم تعد صالحة`, "STALE");
      const link = ops.find((o) => o.op === "LINK_VEHICLE" && o.vehicleId === vs.id);
      if (link && vs.get("driverId") && vs.get("driverId") !== link.driverId) throw new AdjustmentError(409, `المركبة ${vs.get("vehicleNumber") || vs.id} أُسندت لسائق آخر`, "STALE");
    }
    for (const o of loanOps) {
      const clash = loanRes.find((r) => [o.driverId, o.vehicleId].includes(r.resourceId) && windowsOverlap(o.window, r));
      if (clash) throw new AdjustmentError(409, "مورد الإعارة محجوز في نافذة متداخلة", "CONFLICT");
    }
    // ── writes ──
    const applied = { createdRoutes: [], modifiedRoutes: [], vehicleLinks: [], loans: [], externalRequests: [] };
    const tag = { analysisId, alternativeId, approvedBy: user.uid, at: iso(now) };
    for (const o of ops) {
      if (o.op === "UPDATE_ROUTE_STOPS") {
        t.update(db.collection("collection_routes").doc(o.routeId), { orderedStops: o.orderedStops, binIds: o.binIds, "dispatch.adjustments": [tag], updatedAt: iso(now) });
        applied.modifiedRoutes.push({ routeId: o.routeId, routeName: o.routeName, binIds: o.added.length ? o.added : o.binIds.filter((id) => o.expectedPending.includes(id)), removed: o.removed, reordered: o.reordered });
        if (o.driverId) t.set(db.collection("driver_notifications").doc(), { driverId: o.driverId, municipalityId: a.municipalityId, read: false, createdAt: iso(now), source: "adjustment", type: "route_changed", routeId: o.routeId, title: "تعديل على جولتك", body: `${o.routeName} — ${o.reordered ? "تغير ترتيب التوقفات" : ""}${o.added.length ? ` أُضيفت ${o.added.length}` : ""}${o.removed.length ? ` نُقلت ${o.removed.length}` : ""}`.trim() });
      } else if (o.op === "CREATE_ROUTE") {
        t.set(db.collection("collection_routes").doc(o.routeId), { routeName: `جولة تعديل تشغيلي - ${o.driverName}`, municipalityId: a.municipalityId, neighborhoodIds: o.neighborhoodIds, binIds: o.binIds, orderedStops: o.orderedStops,
          status: "approved", driverId: o.driverId, driverName: o.driverName, vehicleId: o.vehicleId, approvedBy: user.uid, approvedAt: iso(now), startedAt: null, completedAt: null, collectedBinIds: [], skippedStops: [], manualBinIds: [],
          estimatedWasteLiters: o.estimatedWasteLiters, scheduledStartAt: o.scheduledStartAt, expectedCollectionAt: check.alternative.completionMin != null ? iso(now + check.alternative.completionMin * 60000) : null,
          dispatch: { auto: false, adjustment: tag, reservedAfterRouteId: o.reservedAfterRouteId }, demo: !!ctx.state.bins.find((b) => o.binIds.includes(b.id))?.demo, createdAt: iso(now), updatedAt: iso(now) });
        applied.createdRoutes.push({ routeId: o.routeId, driverId: o.driverId, binIds: o.binIds, scheduledStartAt: o.scheduledStartAt });
        t.set(db.collection("driver_notifications").doc(), { driverId: o.driverId, municipalityId: a.municipalityId, read: false, createdAt: iso(now), source: "adjustment", type: o.reservedAfterRouteId ? "route_reserved" : "route_assigned", routeId: o.routeId,
          title: o.scheduledStartAt ? "جولة مجدولة عند بداية مناوبتك" : o.reservedAfterRouteId ? "جولتك التالية محجوزة" : "مهمة جديدة مسندة لك", body: `${o.binIds.length} حاوية — تعديل تشغيلي معتمد` });
      } else if (o.op === "LINK_VEHICLE") {
        t.update(db.collection("driver_profiles").doc(o.driverId), { vehicleId: o.vehicleId, updatedAt: iso(now) });
        t.update(db.collection("vehicles").doc(o.vehicleId), { driverId: o.driverId, updatedAt: iso(now) });
        applied.vehicleLinks.push({ driverId: o.driverId, vehicleId: o.vehicleId });
      } else if (o.op === "RESERVE_LOAN") {
        const trRef = db.collection("resource_transfers").doc(`adj_${analysisId}_${o.driverId}`);
        t.set(trRef, { resourceType: o.vehicleId ? "crew" : "driver", resourceId: o.vehicleId || o.driverId, resourceLabel: o.vehicleNumber || o.driverName, driverId: o.driverId, driverName: o.driverName, vehicleId: o.vehicleId, vehicleNumber: o.vehicleNumber,
          fromMunicipalityId: o.fromMunicipalityId, toMunicipalityId: o.toMunicipalityId, status: "approved", window: o.window, until: o.window.endAt, travelMin: o.travelMin, reason: `تعديل تشغيلي معتمد (${analysisId})`, adjustment: tag,
          proposedBy: user.uid, decidedBy: user.uid, decidedByName: user.name || "", decidedAt: iso(now), createdAt: iso(now), updatedAt: iso(now) });
        for (const rid of [o.driverId, o.vehicleId].filter(Boolean)) t.set(db.collection("resource_reservations").doc(`${trRef.id}__${rid}`), { resourceId: rid, transferId: trRef.id, purpose: "adjustment", status: "active", startAt: o.window.startAt, endAt: o.window.endAt, fromMunicipalityId: o.fromMunicipalityId, toMunicipalityId: o.toMunicipalityId, municipalityIds: [o.fromMunicipalityId, o.toMunicipalityId], createdBy: user.uid, createdAt: iso(now) });
        applied.loans.push({ transferId: trRef.id, driverId: o.driverId, vehicleId: o.vehicleId, window: o.window, binIds: o.binIds, executed: false });
      } else if (o.op === "EXTERNAL_REQUEST") applied.externalRequests.push({ kind: o.kind, binIds: o.binIds, note: o.note });
    }
    for (const l of resLocks) t.set(l, { updatedAt: iso(now), lastAdjustmentId: analysisId }, { merge: true });
    t.set(lockRef, { lastAdjustmentId: analysisId, updatedAt: iso(now) }, { merge: true });
    const expected = { costUnits: check.alternative.costUnits, money: check.alternative.money, km: check.alternative.km, kmBasis: "expected_haversine", driveMin: check.alternative.driveMin, completionMin: check.alternative.completionMin,
      completionAt: check.alternative.completionMin != null ? iso(now + check.alternative.completionMin * 60000) : null, serviceLevelMet: check.alternative.slaMet, criticalTargetMin: T.criticalCollectionMin,
      binIds: [...new Set([...applied.createdRoutes.flatMap((r) => r.binIds), ...applied.modifiedRoutes.flatMap((r) => r.binIds)])] };
    t.update(aRef, clean({ status: "APPROVED", approvedAlternativeId: alternativeId, approvedBy: user.uid, approvedByName: user.name || "", approvedRole: user.role, approvedAt: iso(now), applied, expected, operations: ops, updatedAt: iso(now) }));
    t.set(db.collection("audit_log").doc(), { action: "adjustment_approved", actorId: user.uid, actorName: user.name || "", municipalityId: a.municipalityId, source: "server", createdAt: iso(now),
      details: { analysisId, alternativeId, interventions: check.alternative.interventions.map((i) => i.code), created: applied.createdRoutes.length, modified: applied.modifiedRoutes.length, loans: applied.loans.length, external: applied.externalRequests.length } });
    return { already: false, status: "APPROVED", applied, expected };
  });
}

export async function rejectAdjustment(db, { user, analysisId, note = "", now = Date.now() }) {
  const ref = db.collection("adjustment_analyses").doc(analysisId);
  return db.runTransaction(async (t) => {
    const s = await t.get(ref);
    if (!s.exists) throw new AdjustmentError(404, "التحليل غير موجود");
    roleScope(user, s.get("municipalityId"));
    if (s.get("status") === "REJECTED") return { already: true, status: "REJECTED" };
    if (!["PROPOSED", "SIMULATED", "STALE"].includes(s.get("status"))) throw new AdjustmentError(409, "لا يمكن رفض تحليل معتمد");
    t.update(ref, { status: "REJECTED", rejectedBy: user.uid, rejectedByName: user.name || "", rejectedAt: iso(now), rejectNote: note, updatedAt: iso(now) });
    t.set(db.collection("audit_log").doc(), { action: "adjustment_rejected", actorId: user.uid, actorName: user.name || "", municipalityId: s.get("municipalityId"), source: "server", createdAt: iso(now), details: { analysisId, note } });
    return { already: false, status: "REJECTED" };
  });
}

/** APPROVED adjustments of a municipality → outcome from routes + collection events; final EXECUTED / FAILED. */
export async function syncAdjustmentOutcomes(db, mid, now = Date.now()) {
  const list = docs(await db.collection("adjustment_analyses").where("municipalityId", "==", mid).where("status", "==", "APPROVED").get());
  const settings = await readDispatchSettings(db);
  let updated = 0;
  for (const a of list) {
    const ids = [...(a.applied?.createdRoutes || []), ...(a.applied?.modifiedRoutes || [])].map((r) => r.routeId);
    const routes = ids.length ? (await db.getAll(...ids.map((id) => db.collection("collection_routes").doc(id)))).filter((d) => d.exists).map((d) => ({ id: d.id, ...d.data() })) : [];
    const events = [];
    for (const id of ids.slice(0, 30)) events.push(...docs(await db.collection("collection_events").where("routeId", "==", id).get()));
    const loans = await Promise.all((a.applied?.loans || []).map(async (l) => ({ ...l, executed: ["executed", "returned"].includes((await db.collection("resource_transfers").doc(l.transferId).get()).get("status")) })));
    const out = adjustmentOutcome({ ...a, applied: { ...a.applied, loans } }, { routes, events, now, criticalCollectionMin: targetsOf(settings).criticalCollectionMin });
    await db.collection("adjustment_analyses").doc(a.id).update(clean({ outcome: out, ...(out.finalStatus ? { status: out.finalStatus, finalizedAt: iso(now) } : {}), updatedAt: iso(now) }));
    updated += 1;
  }
  return updated;
}
