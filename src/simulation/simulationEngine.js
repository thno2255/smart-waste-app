/**
 * simulationEngine.js — Phase 3: deterministic IoT sensor simulation (pure).
 * ─────────────────────────────────────────────────────────────────────
 * Everything here is a pure function of (config, seed, inputs): the same seed
 * always yields the same scenario and the same evolution, so a judging demo
 * can be reset and replayed exactly. No Firestore, no React.
 *
 *   generateScenario(cfg, env)   → bins placed INSIDE real neighborhood polygons
 *   advance(state, minutes)      → fill rises per bin rate, temperature drifts, batteries drain
 *   applyEvent(state, event)     → critical_fill | heat_spike | sensor_outage | emptied | restore
 *   readingFor(bin, at)          → { binId, sensorId, fillPercentage, temperature, batteryLevel,
 *                                    connectivityStatus, timestamp, source: "SIMULATED" }
 *
 * The scenario numbers (120 bins, 108 online, 12 offline/fault …) are DEMO
 * settings, editable in the UI — never presented as official figures.
 * Bins are placed by rejection sampling inside each neighborhood polygon; no
 * road snapping (no road network data offline), so positions are plausible
 * but NOT real container locations — every bin carries simulated:true.
 * ─────────────────────────────────────────────────────────────────────
 */
import { pointInPolygon } from "../decisionEngine";

export const DEFAULT_SIM_CONFIG = {
  seed: "buraidah-demo-2026",
  totalBins: 120,
  offlineSensors: 8,     // silent > offlineTimeoutMin
  faultSensors: 4,       // out-of-range readings
  fillMix: { normal: 0.55, warning: 0.30, critical: 0.15 },
  thermalAlerts: 3,      // bins with temperature ≥ 45 °C at start
  tickMinutes: 5,        // simulated minutes per tick
  baseTempC: 28,
  binCapacityLiters: [1100, 1100, 1100, 2400],
};

// ── Seeded PRNG (mulberry32) ──────────────────────────────────────────
export function hashSeed(str) {
  let h = 1779033703 ^ String(str).length;
  for (let i = 0; i < String(str).length; i++) { h = Math.imul(h ^ String(str).charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  return (h >>> 0) || 1;
}
export function rng(seed) {
  let a = typeof seed === "number" ? seed >>> 0 : hashSeed(seed);
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Uniform point inside a GeoJSON polygon ring by rejection sampling in its bbox (deterministic with the given rng). */
export function randomPointInPolygon(geometry, rand, maxTries = 200) {
  const ring = geometry.coordinates[0];
  const lngs = ring.map((c) => c[0]), lats = ring.map((c) => c[1]);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs), minLat = Math.min(...lats), maxLat = Math.max(...lats);
  for (let i = 0; i < maxTries; i++) {
    const lat = minLat + rand() * (maxLat - minLat), lng = minLng + rand() * (maxLng - minLng);
    if (pointInPolygon(lat, lng, geometry)) return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
  }
  return { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 };
}

/**
 * @param {object} cfg  DEFAULT_SIM_CONFIG overrides
 * @param {object} env
 * @param {Array<{id:string,name:string}>} env.neighborhoods  Firestore neighborhood docs
 * @param {Map|Object} env.featuresByKey  baseName → GeoJSON feature
 * @param {(n:object)=>string|null} env.municipalityIdFor
 * @param {(name:string)=>string} env.keyFor  normalized neighborhood key
 * @param {number} [env.now]
 */
export function generateScenario(cfg = {}, env = {}) {
  const c = { ...DEFAULT_SIM_CONFIG, ...cfg, fillMix: { ...DEFAULT_SIM_CONFIG.fillMix, ...(cfg.fillMix || {}) } };
  const { neighborhoods = [], featuresByKey, municipalityIdFor = () => null, keyFor = (s) => s, now = Date.now() } = env;
  const getF = (k) => (featuresByKey?.get ? featuresByKey.get(k) : featuresByKey?.[k]) || null;
  const eligible = neighborhoods.map((n) => ({ n, f: getF(keyFor(n.name)) })).filter((x) => x.f);
  if (eligible.length === 0) return { config: c, bins: [], warnings: ["لا توجد أحياء بمضلعات — لا يمكن توزيع الحاويات"] };
  const rand = rng(c.seed);
  const total = Math.max(0, Math.round(c.totalBins));
  const offline = Math.min(total, Math.round(c.offlineSensors)), fault = Math.min(total - offline, Math.round(c.faultSensors));
  const nCrit = Math.round(total * c.fillMix.critical), nWarn = Math.round(total * c.fillMix.warning);
  const bins = [];
  // Round-robin over neighborhoods so every polygon gets a fair share; deterministic order.
  for (let i = 0; i < total; i++) {
    const { n, f } = eligible[i % eligible.length];
    const pos = randomPointInPolygon(f.geometry, rand);
    const idx = i + 1;
    const band = i < nCrit ? "critical" : i < nCrit + nWarn ? "warning" : "normal";
    const fill = band === "critical" ? 85 + Math.floor(rand() * 15) : band === "warning" ? 60 + Math.floor(rand() * 25) : Math.floor(rand() * 60);
    const connectivity = i >= total - offline ? "offline" : i >= total - offline - fault ? "fault" : "online";
    const thermal = i < c.thermalAlerts;
    bins.push({
      simId: `SIM-${String(idx).padStart(3, "0")}`,
      sensorId: `SENS-${c.seed.slice(0, 6).toUpperCase()}-${String(idx).padStart(3, "0")}`,
      name: `حاوية ${keyFor(n.name)} ${Math.floor(i / eligible.length) + 1}`,
      neighborhoodId: n.id, neighborhoodName: n.name, municipalityId: municipalityIdFor(n),
      lat: pos.lat, lng: pos.lng,
      capacityLiters: c.binCapacityLiters[i % c.binCapacityLiters.length],
      wasteType: ["مختلط", "عضوية", "بلاستيك", "ورق"][i % 4],
      fillRatePerHour: Math.round((1.5 + rand() * 4.5) * 100) / 100,   // 1.5–6 %/h, deterministic per bin
      fill: connectivity === "fault" ? 240 : fill,                        // fault → out-of-range value
      temperature: thermal ? 46 + Math.round(rand() * 12) : Math.round((c.baseTempC + rand() * 8 - 2) * 10) / 10,
      battery: connectivity === "offline" ? 3 + Math.floor(rand() * 10) : 40 + Math.floor(rand() * 58),
      connectivity,
      // Offline sensors last reported hours ago; others "just now" (offset so the history is not all identical).
      lastReadingAt: new Date(now - (connectivity === "offline" ? (3 + Math.floor(rand() * 20)) * 3600000 : Math.floor(rand() * 8) * 60000)).toISOString(),
      lastCollectionAt: new Date(now - (6 + Math.floor(rand() * 90)) * 3600000).toISOString(),
      band, thermal,
    });
  }
  // Shuffle deterministically so critical/offline bins are spread across neighborhoods, not clustered by index.
  for (let i = bins.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [bins[i], bins[j]] = [bins[j], bins[i]]; }
  bins.forEach((b, i) => { b.simId = `SIM-${String(i + 1).padStart(3, "0")}`; b.sensorId = `SENS-${c.seed.slice(0, 6).toUpperCase()}-${String(i + 1).padStart(3, "0")}`; });
  const warnings = [];
  if (offline + fault > total) warnings.push("عدد المستشعرات غير المتصلة/المعطلة يتجاوز العدد الكلي");
  return { config: c, bins, warnings, summary: summarize(bins) };
}

export function summarize(bins = []) {
  const online = bins.filter((b) => b.connectivity === "online").length;
  const s = { total: bins.length, online, offline: bins.filter((b) => b.connectivity === "offline").length, fault: bins.filter((b) => b.connectivity === "fault").length, critical: 0, warning: 0, normal: 0, thermal: 0 };
  for (const b of bins) { if (b.connectivity !== "online") continue; if (b.fill >= 85) s.critical += 1; else if (b.fill >= 60) s.warning += 1; else s.normal += 1; if (b.temperature >= 45) s.thermal += 1; }
  return s;
}

/**
 * Advance every bin by `minutes` of simulated time. Deterministic: the step
 * rng is derived from (seed, tickIndex). Offline sensors keep their stale
 * reading; fault sensors keep reporting out-of-range values.
 */
export function advance(state, minutes, tickIndex = 0) {
  const rand = rng(`${state.config.seed}:tick:${tickIndex}`);
  const at = new Date(new Date(state.clock || Date.now()).getTime() + minutes * 60000).toISOString();
  const bins = state.bins.map((b) => {
    if (b.connectivity === "offline") return { ...b }; // no new reading
    const noise = (rand() - 0.5) * 0.6;
    const fill = b.connectivity === "fault" ? 240 : Math.max(0, Math.min(100, Math.round((b.fill + (b.fillRatePerHour * minutes) / 60 + noise) * 10) / 10));
    const temperature = Math.round((b.temperature + (rand() - 0.5) * 1.2 + (b.temperature > 44 ? 0.3 : (b.temperature - state.config.baseTempC) * -0.02)) * 10) / 10;
    const battery = Math.max(0, Math.round((b.battery - (minutes / 60) * 0.08) * 100) / 100);
    return { ...b, fill, temperature, battery, lastReadingAt: at };
  });
  return { ...state, bins, clock: at, tick: (state.tick || 0) + 1 };
}

export const SIM_EVENTS = {
  critical_fill:  { label: "حدث امتلاء حرج",      icon: "🔴" },
  heat_spike:     { label: "ارتفاع حرارة",         icon: "🔥" },
  sensor_outage:  { label: "انقطاع مستشعر",        icon: "📵" },
  sensor_fault:   { label: "خلل مستشعر",           icon: "⚠️" },
  emptied:        { label: "تفريغ حاوية",          icon: "🧹" },
  restore:        { label: "عودة المستشعر",        icon: "📶" },
};

/** Apply one demo event to one bin (by simId or Firestore id stored on the bin as `id`). Returns a new state + a log entry. */
export function applyEvent(state, { type, binId, at = state.clock || new Date().toISOString() }) {
  if (!SIM_EVENTS[type]) throw new Error("حدث غير معروف: " + type);
  const i = state.bins.findIndex((b) => b.simId === binId || b.id === binId);
  if (i < 0) throw new Error("حاوية غير موجودة في المحاكاة: " + binId);
  const b = { ...state.bins[i] };
  switch (type) {
    case "critical_fill": b.fill = Math.max(b.fill, 88 + Math.round(rng(`${b.simId}:cf`)() * 10)); if (b.connectivity === "offline") b.connectivity = "online"; break;
    case "heat_spike":    b.temperature = 55 + Math.round(rng(`${b.simId}:hs`)() * 15); break;
    case "sensor_outage": b.connectivity = "offline"; break;
    case "sensor_fault":  b.connectivity = "fault"; b.fill = 240; break;
    case "emptied":       b.fill = 2 + Math.round(rng(`${b.simId}:em:${at}`)() * 6); b.lastCollectionAt = at; if (b.connectivity === "fault") b.connectivity = "online"; break;
    case "restore":       b.connectivity = "online"; if (b.fill > 100) b.fill = 20; b.battery = Math.max(b.battery, 40); break;
    default: break;
  }
  if (b.connectivity !== "offline") b.lastReadingAt = at;
  const bins = state.bins.slice(); bins[i] = b;
  const entry = { at, type, binId: b.simId, binName: b.name, label: SIM_EVENTS[type].label };
  return { ...state, bins, events: [...(state.events || []), entry].slice(-200), lastEvent: entry };
}

/** Deterministic pick of a bin for an event: prefers online bins in the given municipality/neighborhood. */
export function pickBinFor(state, { type, municipalityId = null, neighborhoodId = null, salt = 0 } = {}) {
  let pool = state.bins.filter((b) => (!municipalityId || b.municipalityId === municipalityId) && (!neighborhoodId || b.neighborhoodId === neighborhoodId));
  if (type === "critical_fill") pool = pool.filter((b) => b.connectivity !== "fault" && b.fill < 85);
  if (type === "heat_spike") pool = pool.filter((b) => b.connectivity === "online" && b.temperature < 45);
  if (type === "sensor_outage") pool = pool.filter((b) => b.connectivity === "online");
  if (type === "emptied") pool = pool.filter((b) => b.fill >= 60 && b.connectivity !== "offline");
  if (type === "restore") pool = pool.filter((b) => b.connectivity !== "online");
  if (pool.length === 0) return null;
  return pool[Math.floor(rng(`${state.config.seed}:pick:${type}:${salt}`)() * pool.length)];
}

/** One sensor reading row for a bin (all fields the spec requires). */
export function readingFor(b, at = new Date().toISOString()) {
  return {
    binId: b.id || null, simId: b.simId, sensorId: b.sensorId,
    fillPercentage: b.connectivity === "fault" ? 240 : Math.round(b.fill * 10) / 10,
    temperature: Math.round(b.temperature * 10) / 10,
    batteryLevel: Math.round(b.battery),
    connectivityStatus: b.connectivity,
    timestamp: at, source: "SIMULATED",
  };
}

/** Bin document fields derived from a simulated bin (the same fields the real ingest route writes — never the reverse). */
export function binDocFrom(b, at) {
  return {
    name: b.name, neighborhoodId: b.neighborhoodId, municipalityId: b.municipalityId || null, lat: b.lat, lng: b.lng,
    capacityLiters: b.capacityLiters, wasteType: b.wasteType, deviceId: b.sensorId, status: "normal",
    lastFillLevelPercent: b.connectivity === "fault" ? 240 : Math.round(b.fill), lastTemperatureCelsius: Math.round(b.temperature * 10) / 10,
    lastBatteryLevel: Math.round(b.battery), lastReadingAt: b.connectivity === "offline" ? b.lastReadingAt : (at || b.lastReadingAt),
    lastCollectionAt: b.lastCollectionAt, sensorConnectivity: b.connectivity,
    simulated: true, demo: true, simId: b.simId, sensorId: b.sensorId, fillRatePerHour: b.fillRatePerHour, locationNote: "موقع افتراضي داخل مضلع الحي (ليس موقع حاوية حقيقية)",
  };
}
