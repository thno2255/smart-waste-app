import { describe, it, expect } from "vitest";
import { generateScenario, advance, applyEvent, pickBinFor, readingFor, binDocFrom, summarize, rng, randomPointInPolygon, DEFAULT_SIM_CONFIG } from "../simulation/simulationEngine";
import { pointInPolygon } from "../decisionEngine";
import { normalizeNeighborhoodName } from "../config";
import geo from "../buraidahNeighborhoods.geo.json";

const featuresByKey = new Map(geo.features.map((f) => [f.properties.baseName, f]));
const neighborhoods = geo.features.map((f, i) => ({ id: `n${i}`, name: f.properties.name }));
const env = { neighborhoods, featuresByKey, keyFor: normalizeNeighborhoodName, municipalityIdFor: (n) => (n.name.includes("الخليج") ? "dirah" : "east"), now: Date.parse("2026-10-12T06:00:00Z") };

describe("deterministic scenario", () => {
  it("same seed → identical scenario; different seed → different", () => {
    const a = generateScenario({}, env), b = generateScenario({}, env), c = generateScenario({ seed: "other" }, env);
    expect(JSON.stringify(a.bins)).toBe(JSON.stringify(b.bins));
    expect(JSON.stringify(a.bins)).not.toBe(JSON.stringify(c.bins));
    expect(rng("x")()).toBe(rng("x")());
  });
  it("matches the demo settings: 120 bins, 108 online, 8 offline, 4 fault, fill mix, thermal alerts", () => {
    const s = generateScenario({}, env).summary;
    expect(s.total).toBe(120); expect(s.online).toBe(108); expect(s.offline).toBe(8); expect(s.fault).toBe(4);
    expect(s.critical).toBeGreaterThan(10); expect(s.warning).toBeGreaterThan(25); expect(s.normal).toBeGreaterThan(45);
    expect(s.thermal).toBe(3);
    const custom = generateScenario({ totalBins: 30, offlineSensors: 2, faultSensors: 1, thermalAlerts: 0 }, env).summary;
    expect(custom).toMatchObject({ total: 30, online: 27, offline: 2, fault: 1, thermal: 0 });
  });
  it("every bin lies inside its own neighborhood polygon and carries municipality + sensor ids", () => {
    const { bins } = generateScenario({}, env);
    for (const b of bins) {
      const f = featuresByKey.get(normalizeNeighborhoodName(b.neighborhoodName));
      expect(pointInPolygon(b.lat, b.lng, f.geometry), b.name).toBe(true);
      expect(b.sensorId).toMatch(/^SENS-/); expect(b.simId).toMatch(/^SIM-\d{3}$/);
      expect(["dirah", "east"]).toContain(b.municipalityId);
      expect(b.fillRatePerHour).toBeGreaterThanOrEqual(1.5); expect(b.fillRatePerHour).toBeLessThanOrEqual(6);
    }
    const perN = {}; for (const b of bins) perN[b.neighborhoodId] = (perN[b.neighborhoodId] || 0) + 1;
    expect(Math.max(...Object.values(perN)) - Math.min(...Object.values(perN))).toBeLessThanOrEqual(1); // fair share
  });
  it("offline sensors have stale readings and low batteries; fault sensors report out-of-range", () => {
    const { bins } = generateScenario({}, env);
    for (const b of bins.filter((x) => x.connectivity === "offline")) { expect(Date.parse(b.lastReadingAt)).toBeLessThan(env.now - 2 * 3600000); expect(b.battery).toBeLessThan(15); }
    for (const b of bins.filter((x) => x.connectivity === "fault")) expect(b.fill).toBe(240);
  });
  it("no polygons → empty scenario with a warning (never invents positions)", () => {
    const r = generateScenario({}, { neighborhoods: [{ id: "x", name: "حي مجهول" }], featuresByKey, keyFor: normalizeNeighborhoodName });
    expect(r.bins).toEqual([]); expect(r.warnings.length).toBe(1);
  });
  it("random point in polygon is deterministic and inside", () => {
    const f = featuresByKey.get("الخليج");
    const p1 = randomPointInPolygon(f.geometry, rng("p")), p2 = randomPointInPolygon(f.geometry, rng("p"));
    expect(p1).toEqual(p2); expect(pointInPolygon(p1.lat, p1.lng, f.geometry)).toBe(true);
  });
});

describe("advance & events", () => {
  const base = () => { const sc = generateScenario({ totalBins: 20, offlineSensors: 2, faultSensors: 1 }, env); return { config: sc.config, bins: sc.bins, clock: new Date(env.now).toISOString(), tick: 0, events: [] }; };
  it("advancing raises fill by rate, is deterministic per tick, leaves offline sensors stale", () => {
    const s0 = base();
    const s1 = advance(s0, 60, 1), s1b = advance(s0, 60, 1);
    expect(JSON.stringify(s1.bins)).toBe(JSON.stringify(s1b.bins));
    const online = s0.bins.findIndex((b) => b.connectivity === "online" && b.fill < 50);
    expect(s1.bins[online].fill).toBeGreaterThan(s0.bins[online].fill);
    expect(s1.bins[online].fill - s0.bins[online].fill).toBeCloseTo(s0.bins[online].fillRatePerHour, 0);
    const off = s0.bins.findIndex((b) => b.connectivity === "offline");
    expect(s1.bins[off].lastReadingAt).toBe(s0.bins[off].lastReadingAt);
    expect(s1.tick).toBe(1); expect(Date.parse(s1.clock) - Date.parse(s0.clock)).toBe(3600000);
    const fault = s0.bins.findIndex((b) => b.connectivity === "fault");
    expect(s1.bins[fault].fill).toBe(240);
  });
  it("fill is clamped to 100 and battery drains", () => {
    let s = base(); for (let i = 1; i <= 40; i++) s = advance(s, 60, i);
    expect(Math.max(...s.bins.filter((b) => b.connectivity === "online").map((b) => b.fill))).toBeLessThanOrEqual(100);
    const i = s.bins.findIndex((b) => b.connectivity === "online");
    expect(s.bins[i].battery).toBeLessThan(base().bins[i].battery);
  });
  it("events: critical fill, heat spike, outage, fault, emptied, restore — with a log", () => {
    let s = base();
    const target = pickBinFor(s, { type: "critical_fill" });
    s = applyEvent(s, { type: "critical_fill", binId: target.simId });
    expect(s.bins.find((b) => b.simId === target.simId).fill).toBeGreaterThanOrEqual(88);
    expect(s.events.at(-1)).toMatchObject({ type: "critical_fill", binId: target.simId });
    s = applyEvent(s, { type: "heat_spike", binId: target.simId }); expect(s.bins.find((b) => b.simId === target.simId).temperature).toBeGreaterThanOrEqual(55);
    s = applyEvent(s, { type: "sensor_outage", binId: target.simId }); expect(s.bins.find((b) => b.simId === target.simId).connectivity).toBe("offline");
    s = applyEvent(s, { type: "restore", binId: target.simId }); expect(s.bins.find((b) => b.simId === target.simId).connectivity).toBe("online");
    s = applyEvent(s, { type: "emptied", binId: target.simId, at: "2026-10-12T07:00:00.000Z" }); const b = s.bins.find((x) => x.simId === target.simId); expect(b.fill).toBeLessThan(10); expect(b.lastCollectionAt).toBe("2026-10-12T07:00:00.000Z");
    s = applyEvent(s, { type: "sensor_fault", binId: target.simId }); expect(s.bins.find((x) => x.simId === target.simId).fill).toBe(240);
    expect(() => applyEvent(s, { type: "nope", binId: target.simId })).toThrow();
    expect(() => applyEvent(s, { type: "emptied", binId: "SIM-999" })).toThrow();
  });
  it("pickBinFor respects municipality scope and is deterministic", () => {
    const s = base();
    const a = pickBinFor(s, { type: "critical_fill", municipalityId: "dirah" }), b = pickBinFor(s, { type: "critical_fill", municipalityId: "dirah" });
    expect(a.simId).toBe(b.simId); expect(a.municipalityId).toBe("dirah");
    expect(pickBinFor(s, { type: "critical_fill", municipalityId: "nowhere" })).toBeNull();
  });
  it("readings carry every required field with source SIMULATED; bin docs are flagged simulated", () => {
    const s = base(); const b = { ...s.bins[0], id: "fs-id" };
    const r = readingFor(b, "2026-10-12T06:05:00.000Z");
    expect(r).toMatchObject({ binId: "fs-id", sensorId: b.sensorId, source: "SIMULATED", timestamp: "2026-10-12T06:05:00.000Z" });
    for (const k of ["fillPercentage", "temperature", "batteryLevel", "connectivityStatus"]) expect(r[k]).not.toBeUndefined();
    const d = binDocFrom(b, "2026-10-12T06:05:00.000Z");
    expect(d.simulated).toBe(true); expect(d.demo).toBe(true); expect(d.deviceId).toBe(b.sensorId); expect(d.locationNote).toContain("ليس موقع حاوية حقيقية");
    expect(summarize(s.bins).total).toBe(20);
    expect(DEFAULT_SIM_CONFIG.totalBins).toBe(120);
  });
});

describe("performance & stability", () => {
  it("generates 1,000 bins and advances them 100 ticks in well under 2 s", () => {
    const t0 = performance.now();
    const sc = generateScenario({ totalBins: 1000, offlineSensors: 60, faultSensors: 20 }, env);
    let s = { config: sc.config, bins: sc.bins, clock: new Date(env.now).toISOString(), tick: 0 };
    for (let i = 1; i <= 100; i++) s = advance(s, 5, i);
    expect(sc.bins.length).toBe(1000);
    expect(s.tick).toBe(100);
    expect(performance.now() - t0).toBeLessThan(2000);
  });
  it("replaying the same seed + the same event sequence reproduces the same state (demo stability)", () => {
    const build = () => { const sc = generateScenario({ totalBins: 50 }, env); let s = { config: sc.config, bins: sc.bins, clock: new Date(env.now).toISOString(), tick: 0, events: [] }; s = advance(s, 5, 1); s = applyEvent(s, { type: "critical_fill", binId: pickBinFor(s, { type: "critical_fill" }).simId }); s = advance(s, 5, 2); return s; };
    expect(JSON.stringify(build().bins)).toBe(JSON.stringify(build().bins));
  });
});
