import { describe, it, expect } from "vitest";
import { simulateDecision, applyScenario, evaluateState, SCENARIO_TYPES } from "../decisionSimulator";

const now = Date.now();
const fresh = new Date(now - 60000).toISOString();
const depot = { lat: 26.33, lng: 43.95 };
const bin = (id, nid, fill, lat, lng) => ({ id, name: id, neighborhoodId: nid, deviceId: "d" + id, lastFillLevelPercent: fill, lastTemperatureCelsius: 28, lastReadingAt: fresh, lat, lng, capacityLiters: 1100, municipalityId: "east" });
const state = () => ({
  municipalityId: "east", municipalityName: "شرق بريدة",
  neighborhoods: [{ id: "n1", name: "حي الخليج" }, { id: "n2", name: "حي الشروق" }],
  bins: [bin("k1", "n1", 92, 26.360, 43.970), bin("k2", "n1", 88, 26.361, 43.972), bin("k3", "n1", 40, 26.362, 43.974), bin("s1", "n2", 95, 26.330, 44.040), bin("s2", "n2", 70, 26.331, 44.041), bin("s3", "n2", 30, 26.332, 44.042)],
  profiles: [
    { uid: "D1", fullName: "أحمد", accountStatus: "active", shiftStatus: "on_shift", availability: "available", vehicleId: "V1", neighborhoodKeys: ["الخليج", "الشروق"], municipalityId: "east" },
    { uid: "D2", fullName: "خالد", accountStatus: "active", shiftStatus: "on_shift", availability: "available", vehicleId: "V2", neighborhoodKeys: ["الخليج", "الشروق"], municipalityId: "east" },
  ],
  vehicles: [{ id: "V1", vehicleNumber: "مركبة 1", status: "available", capacityLiters: 6000, municipalityId: "east" }, { id: "V2", vehicleNumber: "مركبة 2", status: "available", capacityLiters: 6000, municipalityId: "east" }],
  routes: [], incidents: [],
  extraVehicles: [{ id: "V9", vehicleNumber: "مركبة شمال 9", status: "available", capacityLiters: 6000, municipalityId: "north" }],
  extraProfiles: [{ uid: "D9", fullName: "سعد", accountStatus: "active", shiftStatus: "on_shift", availability: "available", vehicleId: null, neighborhoodKeys: ["الأفق"], municipalityId: "north" }],
});

describe("decision simulator", () => {
  it("never mutates the live state (isolated copy)", () => {
    const s = state(); const snapshot = JSON.stringify(s);
    simulateDecision(s, { type: "vehicle_down", vehicleId: "V1" }, { depot, now });
    applyScenario(s, { type: "waste_rate_up", factor: 2 });
    expect(JSON.stringify(s)).toBe(snapshot);
  });
  it("baseline serves both neighborhoods with two crews; a vehicle breakdown leaves a route unassigned", () => {
    const base = evaluateState(state(), { depot, now });
    expect(base.routes).toBe(2); expect(base.unassignedRoutes).toBe(0); expect(base.unserved).toBe(0); expect(Number.isFinite(base.cost)).toBe(true);
    const r = simulateDecision(state(), { type: "vehicle_down", vehicleId: "V1" }, { depot, now });
    expect(r.result.unassignedRoutes).toBe(1); expect(r.result.unserved).toBeGreaterThan(0);
    expect(r.verdict).toBe("worse"); expect(r.recommendation).toContain("لا يُوصى");
    expect(r.explanation[0]).toContain("تعطل مركبة");
  });
  it("driver absence and higher waste generation raise pressure; more critical bins increase demand", () => {
    const a = simulateDecision(state(), { type: "driver_absent", driverId: "D2" }, { depot, now });
    expect(a.delta.pressure).toBeGreaterThan(0);
    const w = simulateDecision(state(), { type: "waste_rate_up", factor: 2 }, { depot, now });
    expect(w.result.served).toBeGreaterThanOrEqual(w.baseline.served);
    const m = simulateDecision(state(), { type: "more_critical", count: 2 }, { depot, now });
    expect(m.notes[0]).toContain("2 حاوية");
  });
  it("transferring a vehicle with a driver from another municipality restores service after a breakdown", () => {
    const broken = applyScenario(state(), { type: "vehicle_down", vehicleId: "V1" }).state;
    const fixed = simulateDecision(broken, { type: "transfer_vehicle", vehicleId: "V9", fromMunicipalityId: "north", withDriver: true, driver: { uid: "D9", fullName: "سعد", accountStatus: "active", shiftStatus: "on_shift", availability: "available" } }, { depot, now });
    expect(fixed.baseline.unassignedRoutes).toBe(1);
    expect(fixed.result.unassignedRoutes).toBe(0);
    expect(fixed.verdict).toBe("better");
    const missing = simulateDecision(state(), { type: "transfer_vehicle", vehicleId: "nope" }, { depot, now });
    expect(missing.notes[0]).toContain("غير متاحة");
  });
  it("road closure adds response time without changing service; vehicle count delta and route delay are reported", () => {
    const r = simulateDecision(state(), { type: "road_closed", delayMin: 20 }, { depot, now });
    expect(r.delta.avgResponseMin).toBe(20); expect(r.delta.unserved).toBe(0); expect(r.verdict).toBe("neutral");
    const v = simulateDecision(state(), { type: "vehicles_count", delta: -2 }, { depot, now });
    expect(v.result.unassignedRoutes).toBe(2);
    expect(Object.keys(SCENARIO_TYPES).length).toBe(9);
  });
});
