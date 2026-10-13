/**
 * dispatchRunner.mjs — server-side executor of the Autonomous Dispatch Engine.
 * ─────────────────────────────────────────────────────────────────────
 * Runs with firebase-admin (service account or local emulator). For each
 * municipality it loads a snapshot, asks the pure engine (src/autoDispatchEngine.js)
 * what to do, then:
 *   • mode "observe": records every decision (status "observed") and changes nothing;
 *   • mode "auto":    executes each in-scope action inside a Firestore TRANSACTION
 *                     that re-reads and re-validates everything it depends on
 *                     (bins still free, driver still free / on shift, vehicle usable,
 *                     route still in the expected state). The decision document id
 *                     is the action's idempotency key, so a repeated or concurrent
 *                     cycle can never execute the same decision twice, and a per-
 *                     municipality lock document serialises concurrent writers.
 * Inter-municipality transfers are never executed here.
 * ─────────────────────────────────────────────────────────────────────
 */
import { FieldValue } from "firebase-admin/firestore";
import { planDispatch, actionInScope, cheapestInsertion, driverBlocker, pendingStops, DEFAULT_DISPATCH_SETTINGS, ESCALATION_LABELS } from "../../src/autoDispatchEngine.js";
import { makeBinContext } from "../../src/binContext.js";
import { driverOrigin } from "../../src/assignmentEngine.js";
import { routeRemaining } from "../../src/driverState.js";
import { analyzeResourceGaps } from "../../src/resourceGapEngine.js";
import { fetchRoadMatrix } from "../../src/roadMatrix.js";

/**
 * Real road approach times (OSRM table): every driver origin (live GPS if fresh, else vehicle depot,
 * else city default) → the first stop of every grouped proposal. Returns { roadTravel, routingStatus }.
 */
export async function computeRoadTravel(state, roadQueries, { now = Date.now(), roadMatrix = fetchRoadMatrix } = {}) {
  const stops = (roadQueries || []).filter((q) => q.firstStop?.lat != null);
  if (stops.length === 0) return { roadTravel: null, routingStatus: "skipped" };
  const origins = state.profiles.map((p) => ({ uid: p.uid, o: driverOrigin(p, state.vehicles.find((v) => v.id === p.vehicleId), { now, fallback: state.depot }) })).filter((x) => x.o?.lat != null);
  // Drivers on a route in progress: also from where they will be when it ends (next-route reservation).
  for (const r of state.routes.filter((x) => x.status === "in_progress" && x.driverId)) {
    const end = routeRemaining(r).endPoint;
    if (end) origins.push({ uid: `${r.driverId}@next`, o: end });
  }
  origins.splice(40);
  if (origins.length === 0) return { roadTravel: null, routingStatus: "skipped" };
  let matrix = null;
  try { matrix = await roadMatrix([...origins.map((x) => x.o), ...stops.map((q) => q.firstStop)]); } catch { matrix = null; }
  if (!matrix?.durations) return { roadTravel: null, routingStatus: "failed" };
  const roadTravel = {};
  stops.forEach((q, j) => {
    roadTravel[q.neighborhoodId] = {};
    origins.forEach((x, i) => { const d = matrix.durations[i]?.[origins.length + j]; const km = matrix.distances?.[i]?.[origins.length + j]; if (d != null && d < 1e5) roadTravel[q.neighborhoodId][x.uid] = { durationMin: Math.round(d), distanceKm: km != null && km < 1e5 ? Math.round(km * 10) / 10 : null }; });
  });
  return { roadTravel, routingStatus: "ok" };
}

export const SETTINGS_PATH = ["dispatch_settings", "config"];
const ACTIVE = ["approved", "in_progress"];
const SYSTEM = { uid: "system:auto-dispatch", name: "الإسناد التلقائي" };
const READINGS_WINDOW_MS = 24 * 3600 * 1000;

const iso = (ms) => new Date(ms).toISOString();
const docs = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));

export async function readDispatchSettings(db) {
  const snap = await db.collection(SETTINGS_PATH[0]).doc(SETTINGS_PATH[1]).get();
  return { ...DEFAULT_DISPATCH_SETTINGS, ...(snap.exists ? snap.data() : {}) };
}

/** Snapshot of one municipality (only what the engine needs). */
export async function loadMunicipalityState(db, mid, now = Date.now()) {
  const byMun = (col) => db.collection(col).where("municipalityId", "==", mid).get().then(docs);
  const since = iso(now - READINGS_WINDOW_MS);
  const [bins, neighborhoods, profiles, vehicles, routesAll, incidents, fireSensors, reports, simReadings, devReadings] = await Promise.all([
    byMun("bins"), byMun("neighborhoods"), byMun("driver_profiles"), byMun("vehicles"),
    db.collection("collection_routes").where("municipalityId", "==", mid).where("status", "in", ["suggested", "approved", "in_progress"]).get().then(docs),
    db.collection("route_incidents").where("municipalityId", "==", mid).where("status", "==", "open").get().then(docs),
    db.collection("fire_sensors").get().then(docs),
    db.collection("citizen_reports").get().then(docs).catch(() => []),
    db.collection("simulated_readings").where("timestamp", ">=", since).get().then(docs),
    db.collection("sensor_readings").where("timestamp", ">=", since).get().then(docs),
  ]);
  const binIds = new Set(bins.map((b) => b.id));
  const readingsByBin = {};
  for (const r of [...simReadings, ...devReadings]) if (binIds.has(r.bin_id)) (readingsByBin[r.bin_id] ||= []).push(r);
  for (const k of Object.keys(readingsByBin)) readingsByBin[k].sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
  const ctx = makeBinContext(fireSensors, reports, neighborhoods);
  const v = vehicles.find((x) => x.depotLat != null);
  return { municipalityId: mid, neighborhoods, bins, readingsByBin, contextFor: ctx.forBin, profiles, vehicles, routes: routesAll, incidents, depot: v ? { lat: v.depotLat, lng: v.depotLng } : null };
}

/** Municipality ids that have bins (the six official ones in this deployment). */
export async function municipalityIds(db) {
  const snap = await db.collection("municipalities").get();
  if (!snap.empty) return snap.docs.map((d) => d.id);
  const bins = await db.collection("bins").select("municipalityId").get();
  return [...new Set(bins.docs.map((d) => d.get("municipalityId")).filter(Boolean))];
}

const decisionBase = (a, ctx) => ({
  key: a.key, municipalityId: ctx.mid, type: a.type, kind: a.kind || null, neighborhoodId: a.neighborhoodId || null, reason: a.reason, suggestion: a.suggestion || null,
  binIds: a.binIds || [], routeId: a.routeId || (a.type === "create_assign" ? `auto_${a.key}` : null), routeName: a.routeName || a.route?.routeName || a.proposal?.routeName || null,
  driverId: a.driverId || null, driverName: a.driverName || null, vehicleId: a.vehicleId || null, vehicleNumber: a.vehicleNumber || null,
  fromDriverId: a.fromDriverId || null, alternatives: a.alternatives || [], approachMin: a.approachMin ?? null, detourKm: a.detourKm ?? null, addedMin: a.addedMin ?? null,
  urgent: !!a.urgent, travelSource: a.travelSource || null, routingNote: a.routingNote || null, runId: ctx.runId, trigger: ctx.trigger, mode: ctx.mode, demo: ctx.demo, updatedAt: iso(ctx.now),
  // Structured decision record (decisionExplain) + resource-gap analysis (resourceGapEngine) — never free text from a model.
  explanation: a.explanation || null, gap: a.gap || null, need: a.need || null, reservation: a.reservation || null,
  etaMin: a.etaMin ?? null, completionMin: a.completionMin ?? null, expectedCollectionAt: a.completionMin != null ? iso(ctx.now + a.completionMin * 60000) : null, targetMissed: !!a.targetMissed,
});

/** Observe mode (or out-of-scope in auto): record the decision once, refresh it on later cycles. */
async function recordObserved(db, a, ctx, note = null) {
  const ref = db.collection("dispatch_decisions").doc(a.key);
  await db.runTransaction(async (t) => {
    const cur = await t.get(ref);
    if (cur.exists && ["executed", "resolved", "dismissed"].includes(cur.get("status"))) return;
    if (cur.exists) t.update(ref, { lastSeenAt: iso(ctx.now), seenCount: FieldValue.increment(1), runId: ctx.runId, reason: a.reason, note, explanation: a.explanation || null, gap: a.gap || null });
    else t.set(ref, { ...decisionBase(a, ctx), status: "observed", note, createdAt: iso(ctx.now), lastSeenAt: iso(ctx.now), seenCount: 1 });
  });
  return "observed";
}

const notify = (t, db, driverId, payload, ctx) => {
  if (!driverId) return;
  t.set(db.collection("driver_notifications").doc(), { driverId, municipalityId: ctx.mid, read: false, createdAt: iso(ctx.now), source: "auto-dispatch", demo: ctx.demo, ...payload });
};
const audit = (t, db, action, details, ctx) => t.set(db.collection("audit_log").doc(), { action, actorId: SYSTEM.uid, actorName: SYSTEM.name, details: { ...details, municipalityId: ctx.mid, runId: ctx.runId, trigger: ctx.trigger }, createdAt: iso(ctx.now) });

/** Execute one action atomically. Returns the final decision status. */
async function execute(db, a, ctx) {
  const decRef = db.collection("dispatch_decisions").doc(a.key);
  const lockRef = db.collection("dispatch_locks").doc(ctx.mid);
  const activeQ = db.collection("collection_routes").where("municipalityId", "==", ctx.mid).where("status", "in", ACTIVE);
  return db.runTransaction(async (t) => {
    // ── reads (all before any write) ──
    const dec = await t.get(decRef);
    if (dec.exists && ["executed", "resolved", "dismissed", "open"].includes(dec.get("status"))) return "duplicate";
    await t.get(lockRef);
    const activeRoutes = docs(await t.get(activeQ));
    const reject = (why) => { t.set(decRef, { ...decisionBase(a, ctx), status: "rejected_at_commit", rejectReason: why, createdAt: dec.exists ? dec.get("createdAt") : iso(ctx.now) }, { merge: true }); t.set(lockRef, { lastRunId: ctx.runId, updatedAt: iso(ctx.now) }, { merge: true }); return "rejected_at_commit"; };
    const busyBins = new Set(activeRoutes.flatMap((r) => pendingStops(r).map((s) => s.binId)));

    if (a.type === "create_assign") {
      const [prof, veh, sugg] = await Promise.all([t.get(db.collection("driver_profiles").doc(a.driverId)), t.get(db.collection("vehicles").doc(a.vehicleId)),
        t.get(db.collection("collection_routes").where("municipalityId", "==", ctx.mid).where("status", "==", "suggested"))]);
      if (a.binIds.some((id) => busyBins.has(id))) return reject("إحدى الحاويات أُضيفت لجولة أخرى قبل التنفيذ");
      if (a.reservation) {
        // Next-route reservation: the driver's ONLY active route must still be the one in progress, with no other reservation.
        const mine = activeRoutes.filter((r) => r.driverId === a.driverId);
        if (mine.length !== 1 || mine[0].id !== a.reservation.afterRouteId || mine[0].status !== "in_progress") return reject("تغيّرت جولة السائق الحالية قبل الحجز");
        if (activeRoutes.some((r) => r.dispatch?.reservedAfterRouteId === a.reservation.afterRouteId)) return reject("للسائق جولة تالية محجوزة");
        if (activeRoutes.some((r) => r.vehicleId === a.vehicleId && r.id !== a.reservation.afterRouteId)) return reject("المركبة في جولة نشطة أخرى");
      } else {
        if (activeRoutes.some((r) => r.driverId === a.driverId)) return reject("السائق حصل على جولة نشطة قبل التنفيذ");
        if (activeRoutes.some((r) => r.vehicleId === a.vehicleId)) return reject("المركبة في جولة نشطة");
      }
      const blocker = driverBlocker({ driverId: a.driverId, vehicleId: a.vehicleId }, { profiles: prof.exists ? [{ uid: prof.id, ...prof.data() }] : [], vehicles: veh.exists ? [{ id: veh.id, ...veh.data() }] : [] });
      if (blocker) return reject(blocker);
      const routeRef = db.collection("collection_routes").doc(`auto_${a.key}`);
      t.set(routeRef, { ...a.route, status: "approved", driverId: a.driverId, driverName: a.driverName, vehicleId: a.vehicleId, approvedBy: SYSTEM.uid, approvedAt: iso(ctx.now), startedAt: null, completedAt: null, manualBinIds: [], collectedBinIds: [],
        dispatch: { auto: true, key: a.key, runId: ctx.runId, trigger: ctx.trigger, reason: a.reason, score: a.score ?? null, confidence: a.confidence || null, approachMin: a.approachMin ?? null, alternatives: a.alternatives || [], nearestOverridden: a.nearestOverridden || null, urgent: !!a.urgent, at: iso(ctx.now),
          explanation: a.explanation || null, reservedAfterRouteId: a.reservation?.afterRouteId || null, expectedStartAt: a.reservation ? iso(ctx.now + a.reservation.startAfterMin * 60000) : null },
        expectedCollectionAt: a.completionMin != null ? iso(ctx.now + a.completionMin * 60000) : null, expectedFirstArrivalAt: a.etaMin != null ? iso(ctx.now + a.etaMin * 60000) : null,
        demo: ctx.demo, createdAt: iso(ctx.now), updatedAt: iso(ctx.now) });
      // the auto route supersedes open suggestions for the same neighborhood (kept in history)
      for (const d of sugg.docs) if ((d.get("neighborhoodIds") || []).includes(a.neighborhoodId)) t.update(d.ref, { status: "withdrawn", withdrawnAt: iso(ctx.now), withdrawReason: `حلّت محلها جولة مسندة تلقائيًا (${a.route.routeName})`, supersededBy: routeRef.id });
      notify(t, db, a.driverId, a.reservation
        ? { type: "route_reserved", routeId: routeRef.id, title: "جولتك التالية محجوزة", body: `${a.route.routeName} — ${a.binIds.length} حاوية، ابدأها بعد إنهاء جولتك الحالية` }
        : { type: "route_assigned", routeId: routeRef.id, title: "مهمة جديدة مسندة لك", body: `${a.route.routeName} — ${a.binIds.length} حاوية${a.urgent ? " (عاجلة)" : ""}` }, ctx);
      audit(t, db, a.reservation ? "route_auto_reserved" : "route_auto_assigned", { routeId: routeRef.id, routeName: a.route.routeName, driverId: a.driverId, driverName: a.driverName, vehicleId: a.vehicleId, bins: a.binIds.length, reason: a.reason, afterRouteId: a.reservation?.afterRouteId || null }, ctx);
      t.set(decRef, { ...decisionBase(a, ctx), routeId: routeRef.id, status: "executed", executedAt: iso(ctx.now), createdAt: dec.exists ? dec.get("createdAt") : iso(ctx.now) }, { merge: true });
    } else if (a.type === "insert") {
      const routeRef = db.collection("collection_routes").doc(a.routeId);
      const [rs, bs] = await Promise.all([t.get(routeRef), t.get(db.collection("bins").doc(a.binIds[0]))]);
      if (!rs.exists || !ACTIVE.includes(rs.get("status"))) return reject("الجولة لم تعد معتمدة/جارية");
      if (busyBins.has(a.binIds[0])) return reject("الحاوية أصبحت ضمن جولة أخرى");
      const route = { id: rs.id, ...rs.data() };
      const veh = route.vehicleId ? await t.get(db.collection("vehicles").doc(route.vehicleId)) : null;
      const cap = Number(veh?.get?.("capacityLiters")) || null;
      if (cap != null && (Number(route.estimatedWasteLiters) || 0) + a.wasteLiters > cap) return reject("السعة المتبقية للمركبة لم تعد كافية");
      const ins = cheapestInsertion(route, { id: bs.id, ...bs.data() });
      if (!ins || ins.addedMin > ctx.settings.insertMaxAddedMin) return reject("ترتيب الجولة تغيّر ولم يعد الإدراج ضمن حد الانحراف");
      const stops = [...(route.orderedStops || [])];
      stops.splice(ins.position, 0, a.stop);
      const ordered = stops.map((s, i) => ({ ...s, order: i + 1 }));
      t.update(routeRef, { orderedStops: ordered, binIds: ordered.map((s) => s.binId), estimatedWasteLiters: (Number(route.estimatedWasteLiters) || 0) + a.wasteLiters,
        estimatedDistanceKm: Math.round(((Number(route.estimatedDistanceKm) || 0) + ins.detourKm) * 10) / 10, "dispatch.insertions": FieldValue.arrayUnion({ binId: a.binIds[0], at: iso(ctx.now), key: a.key, addedMin: ins.addedMin }), updatedAt: iso(ctx.now) });
      notify(t, db, route.driverId, { type: "stop_added", routeId: route.id, title: "أُضيفت حاوية إلى جولتك", body: `${a.stop.binName} — التوقف رقم ${ins.position + 1} (+${ins.addedMin} د)` }, ctx);
      audit(t, db, "route_auto_extended", { routeId: route.id, routeName: route.routeName, binId: a.binIds[0], addedMin: ins.addedMin, reason: a.reason }, ctx);
      t.set(decRef, { ...decisionBase(a, ctx), status: "executed", executedAt: iso(ctx.now), createdAt: dec.exists ? dec.get("createdAt") : iso(ctx.now) }, { merge: true });
    } else if (a.type === "reassign") {
      const routeRef = db.collection("collection_routes").doc(a.routeId);
      const [rs, prof, veh] = await Promise.all([t.get(routeRef), t.get(db.collection("driver_profiles").doc(a.driverId)), t.get(db.collection("vehicles").doc(a.vehicleId))]);
      if (!rs.exists || rs.get("status") !== "approved" || rs.get("driverId") !== a.fromDriverId) return reject("الجولة تغيّرت قبل التنفيذ");
      if (rs.get("dispatch.auto") !== true) return reject("الجولة مسندة يدويًا — لا تُعاد تلقائيًا");
      if (activeRoutes.some((r) => r.id !== a.routeId && r.driverId === a.driverId)) return reject("السائق البديل حصل على جولة نشطة");
      const blocker = driverBlocker({ driverId: a.driverId, vehicleId: a.vehicleId }, { profiles: prof.exists ? [{ uid: prof.id, ...prof.data() }] : [], vehicles: veh.exists ? [{ id: veh.id, ...veh.data() }] : [] });
      if (blocker) return reject(blocker);
      t.update(routeRef, { driverId: a.driverId, driverName: a.driverName, vehicleId: a.vehicleId, approvedAt: iso(ctx.now), "dispatch.reassignments": FieldValue.arrayUnion({ from: a.fromDriverId, to: a.driverId, at: iso(ctx.now), reason: a.reason }), updatedAt: iso(ctx.now) });
      notify(t, db, a.driverId, { type: "route_assigned", routeId: a.routeId, title: "مهمة مُعاد إسنادها إليك", body: `${a.routeName}` }, ctx);
      notify(t, db, a.fromDriverId, { type: "route_removed", routeId: a.routeId, title: "سُحبت جولة منك", body: `${a.routeName} — أُعيد إسنادها لعدم توفرك` }, ctx);
      audit(t, db, "route_auto_reassigned", { routeId: a.routeId, routeName: a.routeName, from: a.fromDriverId, to: a.driverId, reason: a.reason }, ctx);
      t.set(decRef, { ...decisionBase(a, ctx), status: "executed", executedAt: iso(ctx.now), createdAt: dec.exists ? dec.get("createdAt") : iso(ctx.now) }, { merge: true });
    } else if (a.type === "release") {
      const routeRef = db.collection("collection_routes").doc(a.routeId);
      const rs = await t.get(routeRef);
      if (!rs.exists || rs.get("status") !== "approved" || rs.get("driverId") !== a.fromDriverId) return reject("الجولة تغيّرت قبل التنفيذ");
      if (rs.get("dispatch.auto") !== true) return reject("الجولة مسندة يدويًا — لا تُسحب تلقائيًا");
      t.update(routeRef, { status: "suggested", driverId: null, driverName: null, vehicleId: null, approvedBy: null, approvedAt: null, "dispatch.releasedAt": iso(ctx.now), "dispatch.releaseReason": a.reason, updatedAt: iso(ctx.now) });
      notify(t, db, a.fromDriverId, { type: "route_removed", routeId: a.routeId, title: "سُحبت جولة منك", body: a.routeName }, ctx);
      audit(t, db, "route_auto_released", { routeId: a.routeId, routeName: a.routeName, from: a.fromDriverId, reason: a.reason }, ctx);
      t.set(decRef, { ...decisionBase(a, ctx), status: "executed", executedAt: iso(ctx.now), createdAt: dec.exists ? dec.get("createdAt") : iso(ctx.now) }, { merge: true });
    } else if (a.type === "escalate") {
      // A newer escalation of the same issue (same kind + neighborhood/route) replaces the older open one.
      const openSame = (await t.get(db.collection("dispatch_decisions").where("municipalityId", "==", ctx.mid).where("status", "==", "open"))).docs
        .filter((d) => d.id !== a.key && d.get("kind") === a.kind && ((a.routeId && d.get("routeId") === a.routeId) || (!a.routeId && a.neighborhoodId && d.get("neighborhoodId") === a.neighborhoodId)));
      for (const d of openSame) t.update(d.ref, { status: "superseded", supersededBy: a.key, updatedAt: iso(ctx.now) });
      t.set(decRef, { ...decisionBase(a, ctx), kindLabel: ESCALATION_LABELS[a.kind] || a.kind, status: "open", createdAt: iso(ctx.now), lastSeenAt: iso(ctx.now) });
      audit(t, db, "dispatch_escalated", { kind: a.kind, reason: a.reason, routeId: a.routeId || null, bins: (a.binIds || []).length }, ctx);
    } else return "skipped";
    t.set(lockRef, { lastRunId: ctx.runId, updatedAt: iso(ctx.now) }, { merge: true });
    return a.type === "escalate" ? "open" : "executed";
  });
}

/**
 * One dispatch cycle.
 * @param {FirebaseFirestore.Firestore} db
 * @param {{trigger?:string, municipalityId?:string|null, now?:number, force?:boolean, actor?:{uid,name}|null, settingsOverride?:object}} opts
 *   trigger: "cron" | "heartbeat" (periodic, respects periodMinutes) | "critical_reading" | "simulator_event" | "manual" (always run)
 */
export async function runDispatchCycle(db, { trigger = "manual", municipalityId = null, now = Date.now(), force = false, actor = null, settingsOverride = null, roadMatrix = fetchRoadMatrix } = {}) {
  const settings = { ...(await readDispatchSettings(db)), ...(settingsOverride || {}) };
  if (settings.mode === "off") return { skipped: "off", settings };
  const periodic = trigger === "cron" || trigger === "heartbeat";
  if (periodic && !force && settings.lastRunAt && now - new Date(settings.lastRunAt).getTime() < settings.periodMinutes * 60000) return { skipped: "not_due", nextDueAt: iso(new Date(settings.lastRunAt).getTime() + settings.periodMinutes * 60000) };
  const runId = `${iso(now).replace(/[:.]/g, "-")}_${trigger}_${Math.random().toString(36).slice(2, 7)}`;
  const mids = municipalityId ? [municipalityId] : await municipalityIds(db);
  const result = { runId, trigger, mode: settings.mode, scope: settings.scope, startedAt: iso(now), municipalities: {} };

  for (const mid of mids) {
    const state = await loadMunicipalityState(db, mid, now);
    if (state.bins.length === 0) continue;
    // Pass 1 groups the bins; pass 2 re-decides drivers with real road approach times (or a labelled fallback).
    let plan = planDispatch(state, settings, { now });
    let routing = { routingStatus: "skipped" };
    if (settings.useRoadNetwork !== false && plan.roadQueries?.length) {
      routing = await computeRoadTravel(state, plan.roadQueries, { now, roadMatrix });
      plan = planDispatch(state, settings, { now, roadTravel: routing.roadTravel, routingStatus: routing.routingStatus });
    }
    // Resource gaps: what would fix each unserved need / missed target (simulated with the same engine).
    const { gaps, extraActions } = analyzeResourceGaps(state, plan, settings, { now });
    const gapByKey = new Map(gaps.map((g) => [g.key, g.gap]));
    plan.actions = [...plan.actions.map((a) => (gapByKey.has(a.key) && a.type === "escalate" ? { ...a, gap: gapByKey.get(a.key) } : a)), ...extraActions];
    const binsById = new Map(state.bins.map((b) => [b.id, b]));
    const tally = { ...plan.summary, routingStatus: routing.routingStatus, executed: 0, observed: 0, rejected: 0, duplicates: 0, outOfScope: 0, escalationsOpen: 0 };
    for (const a of plan.actions) {
      if (a.type === "defer") continue; // counted in the summary; not a decision document
      const inScope = actionInScope(a, binsById, settings.scope);
      const ctx = { mid, runId, trigger, now, mode: settings.mode, settings, demo: (a.binIds || []).every((id) => binsById.get(id)?.demo === true || binsById.get(id)?.simulated === true) };
      let status;
      if (settings.mode !== "auto") status = await recordObserved(db, a, ctx);
      else if (!inScope) { status = await recordObserved(db, a, ctx, "خارج نطاق التنفيذ (بيئة العرض فقط)"); tally.outOfScope += 1; }
      else status = await execute(db, a, ctx);
      if (status === "executed") tally.executed += 1; else if (status === "observed") tally.observed += 1; else if (status === "rejected_at_commit") tally.rejected += 1; else if (status === "duplicate") tally.duplicates += 1; else if (status === "open") tally.escalationsOpen += 1;
    }
    result.municipalities[mid] = tally;
    // Approved operational adjustments: measure their outcome from the collections confirmed so far.
    try { const { syncAdjustmentOutcomes } = await import("./adjustment.mjs"); tally.adjustmentsSynced = await syncAdjustmentOutcomes(db, mid, now); } catch (e) { tally.adjustmentsSyncError = String(e?.message || e).slice(0, 120); }
  }
  result.finishedAt = iso(Date.now());
  await db.collection("dispatch_runs").doc(runId).set({ ...result, actor: actor ? { uid: actor.uid, name: actor.name || "" } : null, settings: { mode: settings.mode, scope: settings.scope, periodMinutes: settings.periodMinutes } });
  if (!municipalityId || periodic) await db.collection(SETTINGS_PATH[0]).doc(SETTINGS_PATH[1]).set({ lastRunAt: iso(now), lastRunId: runId, lastTrigger: trigger }, { merge: true });
  else await db.collection(SETTINGS_PATH[0]).doc(SETTINGS_PATH[1]).set({ lastUrgentRunAt: iso(now), lastUrgentRunId: runId }, { merge: true });
  return result;
}
