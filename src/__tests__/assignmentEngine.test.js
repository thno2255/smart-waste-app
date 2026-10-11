import { describe, it, expect } from "vitest";
import { rankDriverCandidates, driverOrigin, queuedWasteLiters, WEIGHTS } from "../assignmentEngine";

const now = Date.now();
const ago = (min) => new Date(now - min * 60000).toISOString();
const base = { accountStatus: "active", shiftStatus: "on_shift", availability: "available", neighborhoodKeys: ["الخليج"] };
const route = {
  id: "R1", routeName: "جولة الخليج", status: "suggested", binIds: ["b1", "b2", "b3"], estimatedDistanceKm: 3, estimatedWasteLiters: 2500,
  orderedStops: [{ binId: "b1", lat: 26.36, lng: 43.97 }, { binId: "b2", lat: 26.361, lng: 43.971 }, { binId: "b3", lat: 26.362, lng: 43.972 }],
};
const vehicles = [
  { id: "V1", vehicleNumber: "مركبة 1", status: "available", capacityLiters: 6000, depotLat: 26.30, depotLng: 43.90 },
  { id: "V2", vehicleNumber: "مركبة 2", status: "available", capacityLiters: 2000, depotLat: 26.359, depotLng: 43.969 },
  { id: "V3", vehicleNumber: "مركبة 3", status: "available", capacityLiters: 6000 },
];

describe("driverOrigin", () => {
  it("uses a live location, falls back to the depot and says so, flags stale locations", () => {
    const live = driverOrigin({ lastLocation: { lat: 1, lng: 2, at: ago(1) } }, vehicles[0], { now });
    expect(live.source).toBe("live");
    const depot = driverOrigin({ lastLocation: null }, vehicles[0], { now });
    expect(depot).toMatchObject({ source: "depot", lat: 26.30 });
    const stale = driverOrigin({ lastLocation: { lat: 1, lng: 2, at: ago(45) } }, vehicles[0], { now });
    expect(stale.source).toBe("stale_depot");
    expect(stale.label).toContain("45");
    expect(driverOrigin({}, vehicles[2], { now })).toBeNull();
    expect(driverOrigin({}, vehicles[2], { now, fallback: { lat: 0, lng: 0 } }).source).toBe("default");
  });
});

describe("rankDriverCandidates", () => {
  it("nearest driver is NOT chosen when their vehicle cannot take the load", () => {
    const profiles = [
      { ...base, uid: "far", fullName: "بعيد", vehicleId: "V1" },   // 6000 L, ~9 km away
      { ...base, uid: "near", fullName: "قريب", vehicleId: "V2" },  // 2000 L < 2500 L needed, 100 m away
    ];
    const r = rankDriverCandidates(route, { profiles, vehicles, routes: [route], neighborhoodName: "الخليج", now });
    expect(r.recommended.driverId).toBe("far");
    expect(r.recommended.nearestOverridden).toContain("قريب");
    const near = r.candidates.find((c) => c.profile.uid === "near");
    expect(near.capacityOk).toBe(false);
    expect(near.flags.some((f) => f.includes("السعة المتبقية"))).toBe(true);
  });

  it("uses REAL road time when supplied and labels the source; otherwise Haversine and says so", () => {
    const profiles = [{ ...base, uid: "d1", fullName: "أحمد", vehicleId: "V1" }];
    const withRoad = rankDriverCandidates(route, { profiles, vehicles, routes: [], neighborhoodName: "الخليج", now, travelByDriver: { d1: { distanceKm: 11.2, durationMin: 17 } }, routeRoad: { distanceKm: 4.4, durationMin: 9 } });
    expect(withRoad.recommended.travelSource).toBe("osrm");
    expect(withRoad.recommended.approachMin).toBe(17);
    expect(withRoad.recommended.totalMin).toBe(17 + 9 + 3 * 4);
    expect(withRoad.recommended.totalKm).toBe(15.6);
    const noRoad = rankDriverCandidates(route, { profiles, vehicles, routes: [], neighborhoodName: "الخليج", now });
    expect(noRoad.recommended.travelSource).toBe("haversine");
    expect(noRoad.recommended.reason).toContain("تقدير جوي");
    expect(noRoad.recommended.confidence).toBe("low");
  });

  it("confidence is high only with a live location AND road time", () => {
    const profiles = [{ ...base, uid: "d1", fullName: "أحمد", vehicleId: "V1", lastLocation: { lat: 26.35, lng: 43.96, at: ago(1) } }];
    const r = rankDriverCandidates(route, { profiles, vehicles, routes: [], neighborhoodName: "الخليج", now, travelByDriver: { d1: { distanceKm: 2, durationMin: 5 } } });
    expect(r.recommended.confidence).toBe("high");
    expect(r.candidates[0].origin.source).toBe("live");
  });

  it("workload: a driver with queued routes ranks below an idle equal", () => {
    const profiles = [
      { ...base, uid: "busy", fullName: "مشغول", vehicleId: "V1" },
      { ...base, uid: "idle", fullName: "فارغ", vehicleId: "V3", lastLocation: { lat: 26.30, lng: 43.90, at: ago(1) } },
    ];
    const queued = { id: "R9", status: "approved", driverId: "busy", estimatedWasteLiters: 1000 };
    const r = rankDriverCandidates(route, { profiles, vehicles, routes: [route, queued], neighborhoodName: "الخليج", now });
    expect(r.recommended.driverId).toBe("idle");
    expect(r.candidates.find((c) => c.profile.uid === "busy").queuedRoutes).toBe(1);
    expect(queuedWasteLiters("busy", [route, queued], "R1")).toBe(1000);
  });

  it("ineligible drivers are listed with reasons, never recommended; no eligible → warning", () => {
    const profiles = [{ ...base, uid: "off", fullName: "خارج", vehicleId: "V1", shiftStatus: "off_shift" }];
    const r = rankDriverCandidates(route, { profiles, vehicles, routes: [], neighborhoodName: "الخليج", now });
    expect(r.recommended).toBeNull();
    expect(r.candidates[0].reasons).toContain("خارج المناوبة");
    expect(r.warnings.some((w) => w.includes("لا يوجد سائق مؤهل"))).toBe(true);
    expect(rankDriverCandidates(route, { profiles: [], vehicles, routes: [], neighborhoodName: "الخليج", now }).warnings[0]).toContain("لا توجد ملفات سائقين");
  });

  it("no stop coordinates → travel not computed, warning raised, still recommends by other factors", () => {
    const profiles = [{ ...base, uid: "d1", fullName: "أحمد", vehicleId: "V1" }];
    const r = rankDriverCandidates({ ...route, orderedStops: [] }, { profiles, vehicles, routes: [], neighborhoodName: "الخليج", now });
    expect(r.recommended.approachMin).toBeNull();
    expect(r.warnings.some((w) => w.includes("لا إحداثيات"))).toBe(true);
  });

  it("weights are relative and sum to 100", () => {
    expect(Object.values(WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
  });
});
