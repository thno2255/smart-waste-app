/**
 * simulationRunner.js — Phase 3/4: the Firestore side of the demo simulator.
 * ─────────────────────────────────────────────────────────────────────
 * Turns engine states into writes the rest of the system already consumes:
 *   bins/{id}              lastFillLevelPercent, lastTemperatureCelsius, lastReadingAt, … (simulated:true)
 *   simulated_readings     one row per reading, source "SIMULATED" (+ legacy aliases bin_id /
 *                          fill_level_percent / temperature_celsius so prediction.js keeps working)
 *   simulation_state/current  config, clock, tick, status, speed, bin index, event log
 *
 * Hard guarantees:
 *   • only documents flagged simulated:true are ever touched (checked on load);
 *   • sensor_readings (real device data) is never written — rules forbid it too;
 *   • install is deterministic for a seed: reset = same scenario again.
 * The tick loop runs in the browser tab that pressed "start" (leader); state in
 * Firestore keeps every other tab (and a refresh) consistent.
 * ─────────────────────────────────────────────────────────────────────
 */
import { collection, doc, getDoc, getDocs, query, where, writeBatch, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import { COLLECTIONS , auditActorId, auditMunicipality } from "../firestoreService";
import { generateScenario, advance, applyEvent, pickBinFor, readingFor, binDocFrom, summarize, SIM_EVENTS } from "./simulationEngine";
import { removePreviousDemoData, seedFleetHistory } from "../seedFirestore";
import { normalizeNeighborhoodName } from "../config";
import { municipalityForNeighborhood } from "../municipalities";

COLLECTIONS.SIMULATION_STATE = "simulation_state";
const STATE_DOC = () => doc(db, COLLECTIONS.SIMULATION_STATE, "current");
const ts = () => new Date().toISOString();

const readingRow = (b, at, extra = {}) => {
  const r = readingFor(b, at);
  return { ...r, municipalityId: b.municipalityId || null, bin_id: r.binId, device_id: r.sensorId, fill_level_percent: r.fillPercentage, temperature_celsius: r.temperature, battery_level: r.batteryLevel, receivedAt: at, demo: true, simulated: true, ...extra };
};

async function commitInChunks(ops) {
  let batch = writeBatch(db), n = 0;
  for (const op of ops) { op(batch); n += 1; if (n >= 400) { await batch.commit(); batch = writeBatch(db); n = 0; } }
  if (n > 0) await batch.commit();
}

/** Live simulation state doc. */
export function subscribeSimState(cb) { return onSnapshot(STATE_DOC(), (snap) => cb(snap.exists() ? snap.data() : null), () => cb(null)); }

/**
 * Builds the deterministic scenario and installs it: removes previous demo
 * data (demo:true rows only), writes 120 simulated bins + devices + a short
 * reading history (so prediction has a slope), optional fleet history, and
 * the state doc. Never touches real bins/readings.
 */
export async function installSimulation(cfg, { neighborhoods, featuresByKey, actor, withHistory = true, vehicleIds = [] }) {
  const cleanup = await removePreviousDemoData();
  const scenario = generateScenario(cfg, { neighborhoods, featuresByKey, keyFor: normalizeNeighborhoodName, municipalityIdFor: municipalityForNeighborhood, now: Date.now() });
  if (scenario.bins.length === 0) throw new Error(scenario.warnings.join("، ") || "لا يمكن توليد المشهد");
  const now = ts();
  const ops = [];
  const binIndex = [];
  const seededForHistory = [];
  for (const b of scenario.bins) {
    const ref = doc(collection(db, COLLECTIONS.BINS));
    b.id = ref.id;
    binIndex.push({ id: ref.id, simId: b.simId });
    ops.push((batch) => batch.set(ref, { ...binDocFrom(b, now), createdAt: now, _demoSeedVersion: "sim-" + scenario.config.seed }));
    ops.push((batch) => batch.set(doc(db, COLLECTIONS.IOT_DEVICES, b.sensorId), { deviceId: b.sensorId, binId: ref.id, municipalityId: b.municipalityId || null, label: b.sensorId, deviceKey: "demo-key-not-for-production", deviceKeyHash: null, disabled: b.connectivity === "offline", simulated: true, demo: true, lastSeenAt: b.lastReadingAt, createdAt: now }));
    // 3-point history (−120, −60, −0 min) with the bin's own rate so the prediction engine has a slope from the first second.
    if (b.connectivity === "online") {
      for (const minutesAgo of [120, 60, 0]) {
        const at = new Date(Date.now() - minutesAgo * 60000).toISOString();
        const past = { ...b, fill: Math.max(0, b.fill - (b.fillRatePerHour * minutesAgo) / 60) };
        ops.push((batch) => batch.set(doc(collection(db, COLLECTIONS.SIMULATED_READINGS)), readingRow(past, at)));
      }
    } else if (b.connectivity === "fault") {
      ops.push((batch) => batch.set(doc(collection(db, COLLECTIONS.SIMULATED_READINGS)), readingRow(b, now)));
    }
    seededForHistory.push({ bin: { id: ref.id, name: b.name, neighborhoodId: b.neighborhoodId, lat: b.lat, lng: b.lng, capacityLiters: b.capacityLiters } });
  }
  ops.push((batch) => batch.set(STATE_DOC(), {
    config: scenario.config, status: "stopped", speed: 1, clock: now, tick: 0, binIndex, events: [], summary: scenario.summary,
    installedAt: now, installedBy: actor?.uid || "", leader: null, lastTickAt: null, lastEventSyncAt: now, warnings: scenario.warnings,
  }));
  ops.push((batch) => batch.set(doc(collection(db, COLLECTIONS.AUDIT_LOG)), { action: "simulation_installed", actorId: auditActorId(), municipalityId: auditMunicipality(), actorName: actor?.name || "", details: { seed: scenario.config.seed, bins: scenario.bins.length, cleaned: cleanup.deleted }, createdAt: now }));
  await commitInChunks(ops);
  let history = { routes: 0 };
  if (withHistory && vehicleIds.length) history = await seedFleetHistory(seededForHistory, neighborhoods.map((n) => ({ id: n.id, name: n.name })), vehicleIds);
  return { bins: scenario.bins.length, summary: scenario.summary, cleaned: cleanup.deleted, historyRoutes: history.routes, warnings: scenario.warnings };
}

/** Loads the engine state from Firestore. Throws if any indexed bin is not flagged simulated (safety: never drive real bins). */
export async function loadSimState({ municipalityId = null } = {}) {
  const snap = await getDoc(STATE_DOC());
  if (!snap.exists()) return null;
  const st = snap.data();
  // A municipality-scoped user may only list their own municipality's bins (rules) — load just that slice.
  const binsQ = municipalityId ? query(collection(db, COLLECTIONS.BINS), where("municipalityId", "==", municipalityId), where("simulated", "==", true)) : query(collection(db, COLLECTIONS.BINS), where("simulated", "==", true));
  const binsSnap = await getDocs(binsQ);
  const byId = new Map(binsSnap.docs.map((d) => [d.id, { id: d.id, ...d.data() }]));
  const bins = [];
  for (const { id, simId } of st.binIndex || []) {
    const d = byId.get(id);
    if (!d) continue;
    if (d.simulated !== true) throw new Error(`رفض: الحاوية ${id} ليست محاكاة`);
    bins.push({
      id, simId, sensorId: d.sensorId || d.deviceId, name: d.name, neighborhoodId: d.neighborhoodId, municipalityId: d.municipalityId || null, lat: d.lat, lng: d.lng,
      capacityLiters: d.capacityLiters, wasteType: d.wasteType, fillRatePerHour: d.fillRatePerHour || 3, fill: Number(d.lastFillLevelPercent) || 0,
      temperature: Number(d.lastTemperatureCelsius) || 28, battery: Number(d.lastBatteryLevel) || 50, connectivity: d.sensorConnectivity || "online",
      lastReadingAt: d.lastReadingAt, lastCollectionAt: d.lastCollectionAt,
    });
  }
  return { config: st.config, status: st.status, speed: st.speed || 1, clock: st.clock, tick: st.tick || 0, events: st.events || [], bins, lastEventSyncAt: st.lastEventSyncAt, leader: st.leader, summary: st.summary, partial: !!municipalityId };
}

/** Writes the bins + readings for a new engine state (only simulated bins by construction). */
async function persistState(state, { changedOnly = null, reason = "tick" } = {}) {
  const at = state.clock;
  const ops = [];
  for (const b of state.bins) {
    if (changedOnly && !changedOnly.has(b.id)) continue;
    ops.push((batch) => batch.set(doc(db, COLLECTIONS.BINS, b.id), binDocFrom(b, b.connectivity === "offline" ? b.lastReadingAt : at), { merge: true }));
    if (b.connectivity !== "offline") ops.push((batch) => batch.set(doc(collection(db, COLLECTIONS.SIMULATED_READINGS)), readingRow(b, at, { reason })));
  }
  // A partial (one-municipality) state must not overwrite the city-wide summary or advance the shared clock.
  if (state.partial) ops.push((batch) => batch.set(STATE_DOC(), { events: state.events || [], lastEventAt: ts() }, { merge: true }));
  else ops.push((batch) => batch.set(STATE_DOC(), { clock: state.clock, tick: state.tick, events: state.events || [], summary: summarize(state.bins), lastTickAt: ts(), lastEventSyncAt: state.lastEventSyncAt || null }, { merge: true }));
  await commitInChunks(ops);
}

/** Collection confirmations on simulated bins become an "emptied" simulated reading (sensor response to the physical emptying) — operational event and reading stay separate rows. */
async function syncEmptiedFromCollections(state) {
  const since = state.lastEventSyncAt || new Date(0).toISOString();
  const snap = await getDocs(query(collection(db, COLLECTIONS.COLLECTION_EVENTS), where("collectedAt", ">", since)));
  const ids = new Set(state.bins.map((b) => b.id));
  let next = state; let count = 0; let latest = since; const changed = new Set();
  for (const d of snap.docs) {
    const e = d.data();
    if (e.collectedAt > latest) latest = e.collectedAt;
    if (!ids.has(e.binId)) continue;
    next = applyEvent(next, { type: "emptied", binId: e.binId, at: next.clock });
    changed.add(e.binId); count += 1;
  }
  return { state: { ...next, lastEventSyncAt: latest }, count, changed };
}

/** One simulation tick: sync emptied bins, advance the clock by config.tickMinutes, persist. */
export async function tickSimulation() {
  const st = await loadSimState();
  if (!st || st.status !== "running") return null;
  const synced = await syncEmptiedFromCollections(st);
  if (synced.count > 0) await persistState(synced.state, { changedOnly: synced.changed, reason: "emptied" }); // the sensor's response to the physical emptying
  const next = advance(synced.state, st.config.tickMinutes, st.tick + 1);
  await persistState(next, { reason: "tick" });
  return { tick: next.tick, clock: next.clock, emptied: synced.count, summary: summarize(next.bins) };
}

export async function setSimulationStatus(status, { speed, leader = null } = {}) {
  const patch = { status, leader, updatedAt: ts() };
  if (speed) patch.speed = speed;
  if (status === "running") patch.startedAt = ts();
  await setDoc(STATE_DOC(), patch, { merge: true });
}

/** Fire one demo event. `target` = { binId } | { municipalityId } | { neighborhoodId }; a bin is picked deterministically when not given. */
export async function fireSimulationEvent(type, target = {}, actor) {
  if (!SIM_EVENTS[type]) throw new Error("حدث غير معروف");
  const st = await loadSimState({ municipalityId: target.binId ? null : target.municipalityId || null });
  if (!st) throw new Error("لم تُثبَّت المحاكاة بعد");
  const bin = target.binId ? st.bins.find((b) => b.id === target.binId || b.simId === target.binId) : pickBinFor(st, { type, municipalityId: target.municipalityId || null, neighborhoodId: target.neighborhoodId || null, salt: (st.events || []).length });
  if (!bin) throw new Error("لا توجد حاوية مناسبة لهذا الحدث في النطاق المحدد");
  const at = st.status === "running" ? st.clock : ts();
  const next = applyEvent({ ...st, clock: at }, { type, binId: bin.simId, at });
  await persistState(next, { changedOnly: new Set([bin.id]), reason: type });
  await setDoc(doc(collection(db, COLLECTIONS.AUDIT_LOG)), { action: "simulation_event", actorId: auditActorId(), municipalityId: auditMunicipality(), actorName: actor?.name || "", details: { type, binId: bin.id, binName: bin.name }, createdAt: ts() });
  return { bin, entry: next.lastEvent };
}

/** Reset = re-install the same seed (deterministic), keeping the chosen config. */
export async function resetSimulation(ctx) {
  const snap = await getDoc(STATE_DOC());
  const cfg = snap.exists() ? snap.data().config : {};
  return installSimulation(cfg, ctx);
}

/**
 * Leader loop for the browser: the tab that started the run ticks every
 * realIntervalMs; another tab takes over only if the leader's lastTickAt is
 * older than 3 intervals (crashed tab / closed laptop).
 */
export function realIntervalMs(config, speed) {
  const simMs = (config?.tickMinutes || 5) * 60000;
  return Math.max(3000, Math.round(simMs / Math.max(1, speed || 1)));
}
