/**
 * municipalities.js — Phase 1 of the multi-municipality restructure.
 * ─────────────────────────────────────────────────────────────────────
 * Pure helpers over the provenance-tagged data files:
 *   src/data/municipalities.json             the 6 sub-municipalities (official names/contacts/areas)
 *   src/data/neighborhoodMunicipalityMap.json neighborhood → municipality (visual reading of official maps, unverified)
 *   src/data/buraidahNeighborhoodNames.json   official neighborhood names (SPA, 2024-11-03)
 *
 * Also the canonical role model:
 *   PLATFORM_ADMIN        (legacy users.role "executive")  sees every municipality
 *   MUNICIPALITY_MANAGER  (users.role "manager")           scoped to users.municipalityId
 *   OPERATIONS_EMPLOYEE   (legacy "employee")              scoped to users.municipalityId when set
 *   DRIVER                (legacy "driver")                scoped to own routes (+ municipality)
 *   CITIZEN               (legacy "citizen")
 * Scoping is enforced server-side in firestore.rules (municipalityId on every
 * operational doc); these helpers only mirror the same decision for the UI.
 * ─────────────────────────────────────────────────────────────────────
 */
import municipalitiesData from "./data/municipalities.json";
import mapData from "./data/neighborhoodMunicipalityMap.json";
import namesData from "./data/buraidahNeighborhoodNames.json";
import { normalizeNeighborhoodName, getSensorConnectivity } from "./config";

export const MUNICIPALITIES = municipalitiesData.municipalities;
export const MUNICIPALITY_IDS = MUNICIPALITIES.map((m) => m.id);
export const DATA_PROVENANCE = municipalitiesData._provenance;
export const NEIGHBORHOOD_ASSIGNMENT_PROVENANCE = mapData._provenance;
export const OFFICIAL_NEIGHBORHOOD_NAMES = namesData.names;
export const OFFICIAL_NAMES_SOURCE = { source: namesData.source, url: namesData.url, publishedAt: namesData.publishedAt, status: namesData.status, count: namesData.count };

const byId = new Map(MUNICIPALITIES.map((m) => [m.id, m]));
export const municipalityById = (id) => byId.get(id) || null;
export const municipalityLabel = (id) => byId.get(id)?.shortAr || (id ? String(id) : "غير محددة");

/** Default (file-based) assignment for a neighborhood name; null when the name is not in the map. */
export function defaultAssignmentFor(neighborhoodName) {
  const key = normalizeNeighborhoodName(neighborhoodName || "");
  const a = mapData.assignments[key];
  return a ? { municipalityId: a.municipalityId, confidence: a.confidence, evidence: a.evidence, source: "visual_reading_official_pdf", status: "unverified" } : null;
}

/** Effective municipality for a neighborhood doc: an explicit (admin-set) value wins over the file default. */
export function municipalityForNeighborhood(neighborhood) {
  if (!neighborhood) return null;
  if (neighborhood.municipalityId) return neighborhood.municipalityId;
  return defaultAssignmentFor(neighborhood.name)?.municipalityId || null;
}

/** Is a neighborhood name on the official 130-name list (exact or as a base of a compass-suffixed name)? */
export function isOfficialNeighborhoodName(name) {
  const key = normalizeNeighborhoodName(name || "");
  if (!key) return { official: false, match: null };
  const exact = OFFICIAL_NEIGHBORHOOD_NAMES.find((n) => normalizeNeighborhoodName(n) === key);
  if (exact) return { official: true, match: exact, kind: "exact" };
  const variant = OFFICIAL_NEIGHBORHOOD_NAMES.filter((n) => normalizeNeighborhoodName(n).startsWith(key + " "));
  return variant.length ? { official: true, match: variant.join(" / "), kind: "variant" } : { official: false, match: null };
}

// ── Roles & scope ─────────────────────────────────────────────────────
// Stored values stay (executive/manager/employee/driver/citizen); the canonical names are what the UI shows.
export const CANONICAL_ROLES = { executive: "AMANAH_DECISION_MAKER", manager: "MUNICIPALITY_MANAGER", employee: "OPERATIONS_EMPLOYEE", driver: "DRIVER", citizen: "CITIZEN" };
export const ROLE_LABELS_AR = { AMANAH_DECISION_MAKER: "متخذ القرار — الأمانة", MUNICIPALITY_MANAGER: "متخذ القرار — البلدية", OPERATIONS_EMPLOYEE: "موظف العمليات", DRIVER: "فرد ميداني (سائق)", CITIZEN: "مواطن" };
export const PORTAL_FOR_ROLE = { executive: "amanah", manager: "municipality", employee: "operations", driver: "driver", citizen: "citizen" };
export const PORTAL_LABELS_AR = { amanah: "بوابة متخذي القرار — الأمانة", municipality: "بوابة متخذي القرار — البلدية", operations: "بوابة موظفي العمليات", driver: "بوابة الأفراد — البلدية (السائقون والفرق الميدانية)", citizen: "بوابة المواطنين" };
export const canonicalRole = (legacyRole) => CANONICAL_ROLES[legacyRole] || "CITIZEN";
export const isStaffRole = (legacyRole) => ["executive", "manager", "employee"].includes(legacyRole);

/**
 * Data scope of a user: { all: true } for the platform admin and for legacy
 * staff with no municipality yet (migration period — flagged), otherwise
 * { municipalityId }. Drivers are additionally limited to their own routes.
 */
export function scopeFor(user) {
  if (!user) return { all: false, municipalityId: null, reason: "no user" };
  const role = user.role;
  if (role === "executive") return { all: true, municipalityId: null, reason: "platform admin" };
  if (role === "manager") return user.municipalityId ? { all: false, municipalityId: user.municipalityId, reason: "municipality manager" } : { all: false, municipalityId: null, reason: "manager without municipality" };
  if (role === "employee" || role === "driver") return user.municipalityId ? { all: false, municipalityId: user.municipalityId, reason: role } : { all: true, municipalityId: null, reason: "legacy unscoped staff", legacy: true };
  return { all: false, municipalityId: null, reason: "citizen" };
}
/** Does a doc (with municipalityId) fall inside the user's scope? Docs without municipalityId are visible only to unscoped users. */
export function inScope(user, docMunicipalityId) {
  const s = scopeFor(user);
  if (s.all) return true;
  if (!s.municipalityId) return false;
  return docMunicipalityId === s.municipalityId;
}

// ── Aggregation for the municipalities page ───────────────────────────
/**
 * Per-municipality operational stats from live data. Neighborhood groups come
 * from decisionEngine.groupNeighborhoodsByName; bins must carry neighborhoodId.
 * `binStates` (mapVisual.getBinMapState per bin id) decides critical counts so
 * the page agrees with the map; thermalFor(name) flags thermal alerts.
 */
export function computeMunicipalityStats({ groups = [], neighborhoods = [], bins = [], binStateById = {}, profiles = [], vehicles = [], routes = [], incidents = [], thermalFor = () => false, now = Date.now() } = {}) {
  const neighborhoodById = new Map(neighborhoods.map((n) => [n.id, n]));
  const out = {};
  for (const m of MUNICIPALITIES) out[m.id] = { id: m.id, municipality: m, neighborhoods: [], bins: 0, connected: 0, critical: 0, warning: 0, noData: 0, thermal: 0, driversAvailable: 0, driversOnShift: 0, vehiclesActive: 0, routesActive: 0, routesSuggested: 0, routesApproved: 0, incidentsOpen: 0, status: "no_data", unassignedNeighborhoods: [] };
  const unassigned = [];
  for (const g of groups) {
    const mid = municipalityForNeighborhood(neighborhoodById.get(g.primary?.id) || { name: g.name });
    if (!mid || !out[mid]) { unassigned.push(g); continue; }
    const s = out[mid];
    s.neighborhoods.push(g);
    if (thermalFor(g.name)) s.thermal += 1;
    const idSet = new Set(g.ids);
    for (const b of bins) {
      if (!idSet.has(b.neighborhoodId)) continue;
      s.bins += 1;
      const conn = getSensorConnectivity(b, null, now);
      if (conn === "online") s.connected += 1;
      const st = binStateById[b.id]?.state;
      if (st === "critical") s.critical += 1; else if (st === "warning") s.warning += 1; else if (!st || st === "no_data" || st === "offline" || st === "fault") s.noData += 1;
    }
  }
  for (const p of profiles) { const s = out[p.municipalityId]; if (!s) continue; if (p.shiftStatus === "on_shift") { s.driversOnShift += 1; if (p.availability === "available" && !routes.some((r) => r.status === "in_progress" && r.driverId === p.uid)) s.driversAvailable += 1; } }
  for (const v of vehicles) { const s = out[v.municipalityId]; if (s && v.status === "on_route") s.vehiclesActive += 1; }
  for (const r of routes) { const s = out[r.municipalityId]; if (!s) continue; if (r.status === "in_progress") s.routesActive += 1; else if (r.status === "suggested") s.routesSuggested += 1; else if (r.status === "approved") s.routesApproved += 1; }
  for (const i of incidents) { const s = out[i.municipalityId]; if (s && i.status === "open") s.incidentsOpen += 1; }
  for (const s of Object.values(out)) {
    s.connectedPct = s.bins ? Math.round((s.connected / s.bins) * 100) : null;
    // Overall status: critical bins are never hidden behind an average.
    s.status = s.bins === 0 ? "no_data" : s.critical > 0 || s.thermal > 0 ? "critical" : s.warning > 0 || (s.connectedPct != null && s.connectedPct < 70) ? "warning" : "normal";
  }
  return { byMunicipality: out, unassigned };
}

/** Convex hull (monotone chain) of [lat,lng] points — used for the clearly-labelled DEMO operational zone of a municipality. */
export function convexHull(points = []) {
  const pts = [...points].filter((p) => p && p.length === 2).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a[1] - o[1]) * (b[0] - o[0]) - (a[0] - o[0]) * (b[1] - o[1]);
  const lower = [];
  for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  const upper = [];
  for (const p of pts.reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}

/** Demo operational zone polygon per municipality from its member neighborhood polygons (GeoJSON features keyed by baseName). */
export function operationalZones(featuresByKey, groups = [], neighborhoods = []) {
  const neighborhoodById = new Map(neighborhoods.map((n) => [n.id, n]));
  const pts = {};
  for (const g of groups) {
    const mid = municipalityForNeighborhood(neighborhoodById.get(g.primary?.id) || { name: g.name });
    const f = featuresByKey.get ? featuresByKey.get(g.key) : featuresByKey[g.key];
    if (!mid || !f) continue;
    (pts[mid] ||= []).push(...f.geometry.coordinates[0].map(([lng, lat]) => [lat, lng]));
  }
  return Object.fromEntries(Object.entries(pts).map(([mid, p]) => [mid, { municipalityId: mid, hull: convexHull(p), label: `${municipalityLabel(mid)} — نطاق تشغيلي تجريبي (ليس الحد الإداري)`, status: "demo" }]));
}
