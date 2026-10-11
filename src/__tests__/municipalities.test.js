import { describe, it, expect } from "vitest";
import {
  MUNICIPALITIES, MUNICIPALITY_IDS, defaultAssignmentFor, municipalityForNeighborhood, isOfficialNeighborhoodName,
  canonicalRole, scopeFor, inScope, computeMunicipalityStats, convexHull, operationalZones, DATA_PROVENANCE, OFFICIAL_NAMES_SOURCE,
} from "../municipalities";
import geo from "../buraidahNeighborhoods.geo.json";

describe("municipality data (provenance-tagged)", () => {
  it("has exactly the six Buraidah sub-municipalities with official contacts and areas", () => {
    expect(MUNICIPALITY_IDS.sort()).toEqual(["dirah", "east", "north", "safra", "south", "west"]);
    for (const m of MUNICIPALITIES) {
      expect(m.nameAr).toMatch(/بلدية .* الفرعية/);
      expect(m.email).toContain("@qassim.gov.sa");
      expect(m.areaKm2).toBeGreaterThan(0);
      expect(m.scopeMap.status).toBe("official");
      expect(m.scopeMap.machineReadable).toBe(false);
    }
    expect(MUNICIPALITIES.find((m) => m.id === "north").areaKm2).toBe(595);
    expect(DATA_PROVENANCE.boundaries.status).toBe("unverified");
  });
  it("every OSM neighborhood is mapped to a municipality with evidence and confidence", () => {
    for (const f of geo.features) {
      const a = defaultAssignmentFor(f.properties.baseName);
      expect(a, f.properties.baseName).not.toBeNull();
      expect(MUNICIPALITY_IDS).toContain(a.municipalityId);
      expect(["high", "medium", "low"]).toContain(a.confidence);
      expect(a.status).toBe("unverified");
      expect(a.evidence.length).toBeGreaterThan(10);
    }
    expect(defaultAssignmentFor("حي المريخ")).toBeNull();
  });
  it("an explicit admin assignment wins over the file default", () => {
    expect(municipalityForNeighborhood({ name: "حي الخليج" })).toBe("dirah");
    expect(municipalityForNeighborhood({ name: "حي الخليج", municipalityId: "east" })).toBe("east");
    expect(municipalityForNeighborhood({ name: "حي مجهول" })).toBeNull();
  });
  it("official neighborhood names come from the SPA list (130) and match our names exactly or by compass variant", () => {
    expect(OFFICIAL_NAMES_SOURCE.count).toBe(130);
    expect(isOfficialNeighborhoodName("حي الخليج").kind).toBe("exact");
    expect(isOfficialNeighborhoodName("النقع").kind).toBe("variant"); // النقع الشرقي / النقع الغربي
    expect(isOfficialNeighborhoodName("الإسكان").official).toBe(false);  // not on the registration list — flagged, not invented
  });
});

describe("roles & scope", () => {
  it("maps legacy roles to canonical ones", () => {
    expect(canonicalRole("executive")).toBe("AMANAH_DECISION_MAKER");
    expect(canonicalRole("manager")).toBe("MUNICIPALITY_MANAGER");
    expect(canonicalRole("employee")).toBe("OPERATIONS_EMPLOYEE");
    expect(canonicalRole("driver")).toBe("DRIVER");
    expect(canonicalRole("nope")).toBe("CITIZEN");
  });
  it("platform admin sees all; manager sees own municipality only; manager without municipality sees nothing", () => {
    expect(scopeFor({ role: "executive" }).all).toBe(true);
    expect(scopeFor({ role: "manager", municipalityId: "east" })).toMatchObject({ all: false, municipalityId: "east" });
    expect(inScope({ role: "manager", municipalityId: "east" }, "east")).toBe(true);
    expect(inScope({ role: "manager", municipalityId: "east" }, "north")).toBe(false);
    expect(inScope({ role: "manager", municipalityId: "east" }, undefined)).toBe(false);
    expect(inScope({ role: "manager" }, "east")).toBe(false);
  });
  it("legacy staff without municipality stay unscoped but flagged for migration", () => {
    const s = scopeFor({ role: "employee" });
    expect(s.all).toBe(true);
    expect(s.legacy).toBe(true);
    expect(scopeFor({ role: "employee", municipalityId: "south" }).municipalityId).toBe("south");
    expect(inScope({ role: "citizen" }, "south")).toBe(false);
  });
});

describe("computeMunicipalityStats", () => {
  const neighborhoods = [{ id: "n1", name: "حي الخليج" }, { id: "n2", name: "حي الشروق" }, { id: "n3", name: "حي مجهول" }];
  const groups = [
    { key: "الخليج", name: "حي الخليج", ids: ["n1"], primary: neighborhoods[0] },
    { key: "الشروق", name: "حي الشروق", ids: ["n2"], primary: neighborhoods[1] },
    { key: "مجهول", name: "حي مجهول", ids: ["n3"], primary: neighborhoods[2] },
  ];
  const now = Date.now();
  const bins = [
    { id: "b1", neighborhoodId: "n1", deviceId: "d", lastFillLevelPercent: 90, lastReadingAt: new Date(now - 60000).toISOString() },
    { id: "b2", neighborhoodId: "n1", deviceId: "d", lastFillLevelPercent: 20, lastReadingAt: new Date(now - 60000).toISOString() },
    { id: "b3", neighborhoodId: "n2", deviceId: "d", lastFillLevelPercent: 70, lastReadingAt: new Date(now - 3 * 3600000).toISOString() },
  ];
  const binStateById = { b1: { state: "critical" }, b2: { state: "normal" }, b3: { state: "offline" } };
  it("aggregates per municipality and never hides critical bins behind an average", () => {
    const r = computeMunicipalityStats({ groups, neighborhoods, bins, binStateById, profiles: [{ uid: "D1", municipalityId: "dirah", shiftStatus: "on_shift", availability: "available" }], vehicles: [{ id: "V1", municipalityId: "dirah", status: "on_route" }], routes: [{ id: "R1", municipalityId: "dirah", status: "in_progress", driverId: "D9" }], incidents: [{ municipalityId: "east", status: "open" }], now });
    const d = r.byMunicipality.dirah, e = r.byMunicipality.east;
    expect(d.bins).toBe(2); expect(d.connected).toBe(2); expect(d.critical).toBe(1); expect(d.status).toBe("critical");
    expect(d.driversAvailable).toBe(1); expect(d.vehiclesActive).toBe(1); expect(d.routesActive).toBe(1);
    expect(e.bins).toBe(1); expect(e.connectedPct).toBe(0); expect(e.noData).toBe(1); expect(e.incidentsOpen).toBe(1); expect(e.status).toBe("warning");
    expect(r.byMunicipality.north.status).toBe("no_data");
    expect(r.unassigned.map((g) => g.name)).toEqual(["حي مجهول"]);
  });
  it("thermal alert escalates the municipality to critical even with low fills", () => {
    const r = computeMunicipalityStats({ groups, neighborhoods, bins, binStateById: { b1: { state: "normal" }, b2: { state: "normal" } }, thermalFor: (n) => n === "حي الخليج", now });
    expect(r.byMunicipality.dirah.status).toBe("critical");
    expect(r.byMunicipality.dirah.thermal).toBe(1);
  });
});

describe("operational zones (demo, clearly labelled)", () => {
  it("convex hull of a square with an interior point drops the interior point", () => {
    const h = convexHull([[0, 0], [0, 1], [1, 1], [1, 0], [0.5, 0.5]]);
    expect(h.length).toBe(4);
  });
  it("builds a hull per municipality from member neighborhood polygons and labels it as demo", () => {
    const byKey = new Map(geo.features.map((f) => [f.properties.baseName, f]));
    const neighborhoods = geo.features.map((f, i) => ({ id: `n${i}`, name: f.properties.name }));
    const groups = geo.features.map((f, i) => ({ key: f.properties.baseName, name: f.properties.name, ids: [`n${i}`], primary: neighborhoods[i] }));
    const z = operationalZones(byKey, groups, neighborhoods);
    expect(Object.keys(z).sort()).toEqual(["dirah", "east", "north", "safra", "south", "west"]);
    expect(z.east.hull.length).toBeGreaterThanOrEqual(3);
    expect(z.east.label).toContain("ليس الحد الإداري");
    expect(z.east.status).toBe("demo");
  });
});
