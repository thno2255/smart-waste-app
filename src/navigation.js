/**
 * navigation.js — Phase 4: turn-by-turn helpers for the driver portal.
 * ─────────────────────────────────────────────────────────────────────
 * Pure geometry + OSRM step parsing. No React, no Leaflet, no Firestore.
 *
 *   • parseSteps(osrmRoute)         → flat maneuver list with Arabic text
 *   • projectOnRoute(pos, coords)   → nearest point on the polyline, distance
 *                                     off-route, and distance remaining
 *   • nextManeuver(pos, steps, …)   → the upcoming maneuver + distance to it
 *   • offRouteDecision(samples, …)  → off-route only after N consecutive fixes
 *                                     beyond max(threshold, k × GPS accuracy)
 *   • arrivedAtStop(pos, stop, …)   → within the arrival radius given accuracy
 *
 * Honest limits: OSRM maneuvers carry no lane guidance, no speed limits, no
 * live traffic; GPS accuracy on phones is 5–50 m. The UI shows instructions as
 * assistance and never blocks the driver on them.
 * ─────────────────────────────────────────────────────────────────────
 */

const R = 6371000;
const toRad = (d) => (d * Math.PI) / 180;

/** Fast equirectangular distance in metres (fine for city-scale segments). */
export function distanceM(a, b) {
  if (!a || !b) return Infinity;
  const x = toRad(b.lng - a.lng) * Math.cos(toRad((a.lat + b.lat) / 2));
  const y = toRad(b.lat - a.lat);
  return Math.sqrt(x * x + y * y) * R;
}

/** Bearing from a to b in degrees [0,360). */
export function bearingDeg(a, b) {
  const φ1 = toRad(a.lat), φ2 = toRad(b.lat), Δλ = toRad(b.lng - a.lng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Arabic distance phrase: "بعد 200 متر" / "بعد 1.2 كم". */
export function formatDistanceAr(m) {
  if (m == null || !Number.isFinite(m)) return "";
  if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)} متر`;
  return `${(Math.round(m / 100) / 10).toFixed(1)} كم`;
}

const MOD_AR = { left: "يسارًا", right: "يمينًا", "slight left": "قليلًا إلى اليسار", "slight right": "قليلًا إلى اليمين", "sharp left": "يسارًا بحدة", "sharp right": "يمينًا بحدة", straight: "مستقيمًا", uturn: "دورانًا للخلف" };

/** Arabic instruction for one OSRM step. */
export function instructionAr(step) {
  const m = step?.maneuver || {};
  const mod = MOD_AR[m.modifier] || "";
  const name = step?.name ? ` إلى ${step.name}` : "";
  switch (m.type) {
    case "depart": return "انطلق" + (name || "");
    case "arrive": return "وصلت إلى الحاوية التالية";
    case "turn": return mod === "مستقيمًا" ? `تابع مستقيمًا${name}` : `انعطف ${mod}${name}`;
    case "new name": case "continue": return `تابع مستقيمًا${name}`;
    case "merge": return `اندمج ${mod}${name}`;
    case "on ramp": return `اسلك المخرج ${mod}${name}`;
    case "off ramp": return `اخرج ${mod}${name}`;
    case "fork": return `التزم ${mod === "يسارًا" ? "اليسار" : mod === "يمينًا" ? "اليمين" : mod}${name}`;
    case "end of road": return `في نهاية الطريق انعطف ${mod}${name}`;
    case "roundabout": case "rotary": return `ادخل الدوار واخرج من المخرج ${m.exit || ""}${name}`;
    case "exit roundabout": case "exit rotary": return `اخرج من الدوار${name}`;
    default: return mod ? `انعطف ${mod}${name}` : `تابع${name}`;
  }
}

/**
 * Flatten OSRM legs/steps into maneuvers at absolute coordinates.
 * @param {{legs:Array<{steps:Array}>}} osrmRoute  raw OSRM route (steps=true)
 * @returns {Array<{index:number, legIndex:number, type:string, modifier:string, text:string, lat:number, lng:number, distanceM:number, durationS:number, name:string}>}
 */
export function parseSteps(osrmRoute) {
  const out = [];
  (osrmRoute?.legs || []).forEach((leg, legIndex) => {
    (leg.steps || []).forEach((st) => {
      const [lng, lat] = st.maneuver?.location || [];
      out.push({ index: out.length, legIndex, type: st.maneuver?.type || "", modifier: st.maneuver?.modifier || "", text: instructionAr(st), lat, lng, distanceM: st.distance || 0, durationS: st.duration || 0, name: st.name || "" });
    });
  });
  return out;
}

/**
 * Nearest point on the polyline (array of [lat,lng]) to pos.
 * @returns {{distanceM:number, segIndex:number, point:{lat,lng}, remainingM:number, traveledM:number}}
 */
export function projectOnRoute(pos, coords = []) {
  if (!pos || coords.length < 2) return { distanceM: Infinity, segIndex: -1, point: null, remainingM: null, traveledM: null };
  let best = { distanceM: Infinity, segIndex: -1, point: null, t: 0 };
  const cum = [0];
  for (let i = 0; i < coords.length - 1; i++) {
    const a = { lat: coords[i][0], lng: coords[i][1] }, b = { lat: coords[i + 1][0], lng: coords[i + 1][1] };
    cum.push(cum[i] + distanceM(a, b));
    // project in a local flat frame
    const k = Math.cos(toRad(a.lat));
    const ax = 0, ay = 0, bx = (b.lng - a.lng) * k, by = b.lat - a.lat, px = (pos.lng - a.lng) * k, py = pos.lat - a.lat;
    const len2 = bx * bx + by * by;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * bx + (py - ay) * by) / len2));
    const q = { lat: a.lat + t * by, lng: a.lng + (t * bx) / k };
    const d = distanceM(pos, q);
    if (d < best.distanceM) best = { distanceM: d, segIndex: i, point: q, t };
  }
  const total = cum[cum.length - 1];
  const traveled = cum[best.segIndex] + best.t * (cum[best.segIndex + 1] - cum[best.segIndex]);
  return { distanceM: best.distanceM, segIndex: best.segIndex, point: best.point, remainingM: Math.max(0, total - traveled), traveledM: traveled, totalM: total };
}

/**
 * Upcoming maneuver: the first maneuver whose along-route position is ahead of
 * the driver's projection. Returns null when there are no steps.
 * @param {Array} steps parseSteps() output
 * @param {Array<[number,number]>} coords route polyline
 */
export function nextManeuver(pos, steps = [], coords = []) {
  if (!pos || steps.length === 0) return null;
  const me = projectOnRoute(pos, coords);
  let best = null;
  for (const st of steps) {
    if (st.type === "depart") continue;
    const along = projectOnRoute({ lat: st.lat, lng: st.lng }, coords).traveledM;
    if (along == null) continue;
    if (along >= (me.traveledM ?? 0) - 15) { best = { ...st, distanceToM: Math.max(0, along - (me.traveledM ?? 0)) }; break; }
  }
  return best;
}

/**
 * Off-route decision from a window of recent samples {distanceM, accuracyM}.
 * Off-route only when the LAST `consecutive` samples are all beyond the
 * tolerance, which scales with GPS accuracy so a noisy fix never triggers it.
 */
export function offRouteDecision(samples = [], { baseToleranceM = 40, accuracyFactor = 1.5, consecutive = 3 } = {}) {
  if (samples.length < consecutive) return { offRoute: false, reason: "عينات غير كافية" };
  const recent = samples.slice(-consecutive);
  const allOff = recent.every((s) => s.distanceM > Math.max(baseToleranceM, accuracyFactor * (s.accuracyM || 0)));
  return { offRoute: allOff, reason: allOff ? `خارج المسار في ${consecutive} قراءات متتالية` : "" };
}

/** Arrived when within the radius (radius grows with poor accuracy, capped). */
export function arrivedAtStop(pos, stop, { radiusM = 30, accuracyM = 0, maxRadiusM = 80 } = {}) {
  if (!pos || !stop || stop.lat == null) return false;
  const r = Math.min(maxRadiusM, Math.max(radiusM, accuracyM));
  return distanceM(pos, stop) <= r;
}

/** Quality label for a GPS fix. */
export function fixQuality(accuracyM) {
  if (accuracyM == null) return { level: "unknown", label: "دقة غير معروفة" };
  if (accuracyM <= 20) return { level: "good", label: `دقة ${Math.round(accuracyM)} م` };
  if (accuracyM <= 60) return { level: "fair", label: `دقة متوسطة ${Math.round(accuracyM)} م` };
  return { level: "poor", label: `دقة ضعيفة ${Math.round(accuracyM)} م — الإرشاد تقريبي` };
}

/** Throttle rule for persisting locations: every `minMs` or `minMoveM`, whichever first. */
export function shouldPersistLocation(prev, next, { minMs = 20000, minMoveM = 50 } = {}) {
  if (!next) return false;
  if (!prev) return true;
  const dt = new Date(next.at).getTime() - new Date(prev.at).getTime();
  return dt >= minMs || distanceM(prev, next) >= minMoveM;
}
