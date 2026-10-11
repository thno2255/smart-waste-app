import { describe, it, expect } from "vitest";
import { municipalityPressure, pressureWithCrews, recommendTransfers, compareMunicipalities, CREW_BINS_PER_HOUR } from "../interMunicipalEngine";

const M = { north: { id: "north", shortAr: "شمال بريدة" }, east: { id: "east", shortAr: "شرق بريدة" }, west: { id: "west", shortAr: "غرب بريدة" } };
const bins = (n, fill) => Array.from({ length: n }, (_, i) => ({ id: `b${fill}${i}`, lastFillLevelPercent: fill }));
const driver = (uid, extra = {}) => ({ uid, fullName: uid, shiftStatus: "on_shift", availability: "available", vehicleId: "V" + uid, ...extra });
const vehicle = (id, extra = {}) => ({ id, vehicleNumber: id, status: "available", ...extra });

describe("municipality pressure", () => {
  it("rises with critical/warning bins and incidents, falls with ready crews; reasons are explicit", () => {
    const hot = municipalityPressure(M.north, { bins: [...bins(30, 92), ...bins(6, 70)], profiles: [driver("n1")], vehicles: [vehicle("Vn1")], routes: [], incidents: [{ status: "open" }] });
    const calm = municipalityPressure(M.east, { bins: bins(2, 70), profiles: [driver("e1"), driver("e2")], vehicles: [vehicle("Ve1"), vehicle("Ve2")], routes: [], incidents: [] });
    expect(hot.index).toBeGreaterThan(calm.index);
    expect(hot.level).toBe("critical"); expect(calm.level).toBe("low");
    expect(hot.reasons[0]).toContain("30 حاوية حرجة");
    expect(hot.demandUnits).toBe(30 + 3 + 0.5);
    expect(calm.capacityUnits).toBeCloseTo(2 * CREW_BINS_PER_HOUR * 4, 1);
  });
  it("no capacity + demand → 100; drivers on active routes are not spare", () => {
    const p = municipalityPressure(M.west, { bins: bins(3, 90), profiles: [], vehicles: [], routes: [], incidents: [] });
    expect(p.index).toBe(100); expect(p.reasons).toContain("لا طاقة تشغيلية متاحة الآن");
    const q = municipalityPressure(M.east, { bins: bins(1, 90), profiles: [driver("e1")], vehicles: [vehicle("Ve1", { status: "on_route", driverId: "e1" })], routes: [{ status: "in_progress", driverId: "e1" }], incidents: [] });
    expect(q.spareDrivers.length).toBe(0); expect(q.activeRoutes).toBe(1);
    expect(pressureWithCrews(q, +1).index).toBeLessThan(q.index);
  });
});

describe("transfer recommendations", () => {
  const centroids = { north: { lat: 26.40, lng: 43.95 }, east: { lat: 26.33, lng: 44.03 }, west: { lat: 26.37, lng: 43.89 } };
  it("recommends a transfer only when the donor stays healthy, and quantifies impact on both sides", () => {
    const north = municipalityPressure(M.north, { bins: [...bins(14, 92), ...bins(6, 70)], profiles: [driver("n1")], vehicles: [vehicle("Vn1")], routes: [], incidents: [] });
    const east = municipalityPressure(M.east, { bins: bins(1, 70), profiles: [driver("e1"), driver("e2"), driver("e3")], vehicles: [vehicle("Ve1"), vehicle("Ve2"), vehicle("Ve3")], routes: [], incidents: [] });
    const r = recommendTransfers([north, east], { centroids });
    expect(r.shortages.map((s) => s.municipalityId)).toEqual(["north"]);
    expect(r.recommendations.length).toBe(1);
    const rec = r.recommendations[0];
    expect(rec.fromMunicipalityId).toBe("east"); expect(rec.toMunicipalityId).toBe("north"); expect(rec.resourceType).toBe("crew");
    expect(rec.impact.receiverAfter).toBeLessThan(rec.impact.receiverBefore);
    expect(rec.impact.donorAfter).toBeGreaterThanOrEqual(rec.impact.donorBefore);
    expect(rec.travelMin).toBeGreaterThan(0); expect(rec.travelSource).toBe("haversine");
    expect(rec.reason).toContain("شرق بريدة"); expect(rec.reason).toContain("يخفض ضغطها");
    expect(rec.net).toBeGreaterThan(0);
  });
  it("rejects transfers that would push the donor over the ceiling or exceed travel limits, and explains it", () => {
    const north = municipalityPressure(M.north, { bins: bins(14, 92), profiles: [], vehicles: [], routes: [], incidents: [] }); // 100: no crews
    const eastTight = municipalityPressure(M.east, { bins: bins(20, 92), profiles: [driver("e1"), driver("e2")], vehicles: [vehicle("Ve1"), vehicle("Ve2")], routes: [], incidents: [] }); // 33 → 67 after giving one crew
    const r = recommendTransfers([north, eastTight], { centroids });
    expect(r.recommendations.length).toBe(0);
    expect(r.warnings[0]).toContain("شمال بريدة");
    const far = recommendTransfers([north, municipalityPressure(M.east, { bins: [], profiles: [driver("e1"), driver("e2")], vehicles: [vehicle("Ve1"), vehicle("Ve2")], routes: [], incidents: [] })], { centroids: { north: { lat: 26.4, lng: 43.9 }, east: { lat: 25.4, lng: 44.9 } } });
    expect(far.recommendations.length).toBe(0); expect(far.warnings[0]).toContain("زمن الانتقال");
  });
  it("uses real road travel when supplied and never proposes a driver where no vehicle awaits", () => {
    const north = municipalityPressure(M.north, { bins: bins(14, 92), profiles: [], vehicles: [], routes: [], incidents: [] });
    const east = municipalityPressure(M.east, { bins: [], profiles: [driver("e1", { vehicleId: null }), driver("e2", { vehicleId: null })], vehicles: [], routes: [], incidents: [] });
    const r = recommendTransfers([north, east], { centroids, travel: () => ({ distanceKm: 12, durationMin: 18, source: "osrm" }) });
    // east has spare drivers but no vehicles; north has no vehicle to give them → driver transfer rejected
    expect(r.recommendations.length).toBe(0);
    expect(r.warnings[0]).toMatch(/لا مركبة|لا موارد/);
  });
  it("comparison ranks municipalities by pressure", () => {
    const ps = [municipalityPressure(M.north, { bins: bins(10, 92), profiles: [], vehicles: [] }), municipalityPressure(M.east, { bins: bins(1, 70), profiles: [driver("e1")], vehicles: [vehicle("Ve1")] })];
    const c = compareMunicipalities(ps);
    expect(c[0].municipalityId).toBe("north"); expect(c[0].rank).toBe(1); expect(c[0].relative).toBe(100);
  });
});

describe("capacity needs a vehicle", () => {
  it("a ready driver whose truck is in maintenance is not capacity (pressure → 100 with demand)", () => {
    const p = municipalityPressure(M.east, { bins: bins(5, 92), profiles: [driver("e1", { vehicleId: "Ve1" })], vehicles: [vehicle("Ve1", { status: "maintenance" })], routes: [], incidents: [] });
    expect(p.crews).toBe(0); expect(p.index).toBe(100); expect(p.reasons.at(-1)).toContain("بلا مركبة صالحة");
    const ok = municipalityPressure(M.east, { bins: bins(5, 92), profiles: [driver("e1", { vehicleId: "Ve1" })], vehicles: [vehicle("Ve1")], routes: [], incidents: [] });
    expect(ok.crews).toBe(1); expect(ok.index).toBeLessThan(100);
    expect(pressureWithCrews(p, +1).index).toBe(ok.index); // a transferred crew restores exactly one crew of capacity
  });
});
