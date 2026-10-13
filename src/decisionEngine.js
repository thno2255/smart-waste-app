/**
 * decisionEngine.js
 * ─────────────────────────────────────────────────────────────────────
 * Central, rule-based decision-support logic (Phase 3). Every page that
 * needs a priority score, a neighborhood ranking, or a route suggestion
 * calls into THIS module — none of it is re-derived inside a component.
 *
 * Deliberately NOT a VRP solver and NOT ML: a weighted score + a greedy
 * nearest-neighbor ordering, fully explainable via `reasons[]` on every
 * output. No LLM/AI call anywhere in this file — see config.js's own
 * comment on tempDangerC for why "AI" stays out of decision logic.
 * ─────────────────────────────────────────────────────────────────────
 */

import { THRESHOLDS, STATE_LABELS, normalizeNeighborhoodName } from "./config.js";
import { predictFullTime } from "./prediction.js";
import { getSensorHealth } from "./sensorHealth.js";
import { hygieneRisk } from "./thermalExposure.js";

const HOUR_MS = 60 * 60 * 1000;

// ══════════════════════════════════════════════════════════════════════
// Bin priority score — §3/§4
// ══════════════════════════════════════════════════════════════════════

function scoreToTier(score) {
  if (score >= 80) return "critical";
  if (score >= 55) return "high";
  if (score >= 30) return "medium";
  return "low";
}

// Each of these maps its own signal onto the SAME 0-100 scale as the tier
// cutoffs above (30/55/80), so a single severe signal alone is enough to
// land a bin in the matching tier — e.g. fill=92% must reach "critical" on
// its own, it can't be diluted down to "medium" just because temperature/
// prediction happen to be at zero. The three are then combined by MAX (the
// worst single signal sets the floor), with smaller additive bonuses for
// compounding risk, time-since-collection, and an active thermal alert.
function fillScore(fill) {
  if (fill == null || Number.isNaN(fill)) return 0;
  const f = Math.max(0, Math.min(100, fill));
  if (f < THRESHOLDS.fillWarningPct) return (f / THRESHOLDS.fillWarningPct) * 29;
  if (f < THRESHOLDS.fillHighPct) return 30 + ((f - THRESHOLDS.fillWarningPct) / (THRESHOLDS.fillHighPct - THRESHOLDS.fillWarningPct)) * 24;
  if (f < THRESHOLDS.fillCriticalPct) return 55 + ((f - THRESHOLDS.fillHighPct) / (THRESHOLDS.fillCriticalPct - THRESHOLDS.fillHighPct)) * 24;
  return 80 + Math.min(20, ((f - THRESHOLDS.fillCriticalPct) / (100 - THRESHOLDS.fillCriticalPct)) * 20);
}

function tempScore(temp) {
  if (temp == null) return 0;
  const t = Number(temp);
  if (t < THRESHOLDS.tempWarningC) return 0;
  if (t < THRESHOLDS.tempCriticalC) return 30 + ((t - THRESHOLDS.tempWarningC) / (THRESHOLDS.tempCriticalC - THRESHOLDS.tempWarningC)) * 24;
  if (t < THRESHOLDS.tempDangerC) return 55 + ((t - THRESHOLDS.tempCriticalC) / (THRESHOLDS.tempDangerC - THRESHOLDS.tempCriticalC)) * 24;
  return 80 + Math.min(20, ((t - THRESHOLDS.tempDangerC) / 10) * 20);
}

// Heat-hygiene signal on the same 0-100 scale: reaching the degree-day limit before
// the next run is a "collect today" signal (critical); approaching it is "high".
function hygieneScore(h) {
  if (!h?.available) return 0;
  if (h.projectedRatio >= 1) return 85;
  if (h.projectedRatio >= 0.75) return 55 + ((h.projectedRatio - 0.75) / 0.25) * 24;
  return Math.max(0, h.projectedRatio) * 54 / 0.75;
}

/**
 * Fill estimate when the sensor can't be trusted (offline, out-of-range, frozen):
 * the bin's learned fill rate × time since the server-confirmed emptying.
 * A silent sensor must never make a filling bin look empty.
 */
export function estimateFillWithoutSensor(bin, now = Date.now()) {
  const rate = Number(bin?.learnedFillRatePerDay);
  const t = bin?.lastCollectionAt ? new Date(bin.lastCollectionAt).getTime() : NaN;
  if (!Number.isFinite(rate) || rate <= 0 || !Number.isFinite(t)) return null;
  const days = Math.max(0, (now - t) / (24 * HOUR_MS));
  return Math.min(THRESHOLDS.maxEstimatedFillPct, rate * days);
}

function predictedScore(prediction) {
  if (!prediction?.predictionAvailable || prediction.hoursToFull > THRESHOLDS.predictionWindowHours) return 0;
  return Math.max(0, 100 * (1 - prediction.hoursToFull / THRESHOLDS.predictionWindowHours));
}

/**
 * @param {object} bin
 * @param {object} [latestReading]
 * @param {Array<object>} [recentReadings] bounded window for this bin
 * @param {{thermalAlert?: boolean, citizenReportCount?: number}} [context] citizenReportCount = open citizen "حاوية ممتلئة" reports pointing at THIS bin
 * @returns {{score:number, tier:"low"|"medium"|"high"|"critical", reasons:string[], prediction:object, sensorHealth:object}}
 */
export function getBinPriority(bin, latestReading, recentReadings = [], context = {}) {
  const { thermalAlert = false, citizenReportCount = 0, heatModelMode = "observe", now = Date.now() } = context;
  const measuredFill = Number(latestReading?.fill_level_percent ?? bin?.lastFillLevelPercent);
  const temp = latestReading?.temperature_celsius ?? bin?.lastTemperatureCelsius;
  const prediction = predictFullTime(bin, recentReadings);
  const sensorHealth = getSensorHealth(bin, latestReading, recentReadings, now);

  // Sensor trust: an offline / out-of-range / frozen sensor is not believed; the fill is then
  // dead-reckoned from the learned rate and the last emptying (never discounted downwards).
  const untrusted = sensorHealth.connectivity === "offline" || sensorHealth.connectivity === "fault" || sensorHealth.stuck === true
    || (sensorHealth.connectivity === "no_sensor" && Number.isNaN(measuredFill));
  const estimatedFill = untrusted ? estimateFillWithoutSensor(bin, now) : null;
  const fill = estimatedFill != null ? estimatedFill : measuredFill;
  const fillComponent = Number.isNaN(fill) ? 0 : Math.max(0, Math.min(100, fill));
  const fillComp = fillScore(fillComponent);
  const tempComp = tempScore(temp == null ? null : Number(temp));
  const predictedComp = predictedScore(prediction);
  const hygiene = hygieneRisk(bin, recentReadings, now);
  const hygieneActive = heatModelMode === "active" && hygiene.available;
  const hygieneComp = hygieneActive ? hygieneScore(hygiene) : 0;

  let timeSinceCollectionComponent = 0;
  if (bin?.lastCollectionAt) {
    const hoursSince = (Date.now() - new Date(bin.lastCollectionAt).getTime()) / HOUR_MS;
    timeSinceCollectionComponent = Math.max(0, Math.min(100, (100 * hoursSince) / THRESHOLDS.longSinceCollectionHours));
  }

  // The worst single signal sets the floor (so one severe factor alone can
  // reach "critical"); the second-worst contributes a smaller compounding
  // bonus, since two elevated signals together are worse than either alone.
  const components = [fillComp, tempComp, predictedComp, hygieneComp].sort((a, b) => b - a);
  const [primary, secondary] = components;

  let raw = primary + 0.15 * secondary + 0.10 * timeSinceCollectionComponent;
  if (thermalAlert) raw += 15;
  // Citizen reports are a SECONDARY, confirming signal (§19): they nudge a bin
  // up and are shown as a reason, but can never alone make a low bin critical.
  const reportBonus = Math.min(20, Math.max(0, Number(citizenReportCount) || 0) * 10);
  raw += reportBonus;
  raw = Math.min(100, raw);

  // No confidence discount: lowering the score of a bin whose sensor is unhealthy hides full bins
  // behind a broken sensor (the research simulation: +57% overflow). Untrusted sensors are handled
  // by the fill estimate above and flagged in the reasons instead.
  const score = Math.round(Math.max(0, Math.min(100, raw)));
  const tier = scoreToTier(score);

  const reasons = [];
  if (estimatedFill != null) reasons.push(`المستشعر غير موثوق — امتلاء مقدَّر ${Math.round(estimatedFill)}% من معدل الحاوية والوقت منذ آخر تفريغ`);
  if (fillComponent >= THRESHOLDS.fillCriticalPct) reasons.push(`نسبة الامتلاء ${Math.round(fillComponent)}%`);
  else if (fillComponent >= THRESHOLDS.fillHighPct) reasons.push(`نسبة الامتلاء مرتفعة (${Math.round(fillComponent)}%)`);
  else if (fillComponent >= THRESHOLDS.fillWarningPct) reasons.push(`نسبة الامتلاء ${Math.round(fillComponent)}% وتحتاج متابعة`);

  if (temp != null && Number(temp) >= THRESHOLDS.tempCriticalC) reasons.push(`درجة الحرارة ${Number(temp).toFixed(0)}°م مرتفعة`);

  if (prediction.predictionAvailable) {
    if (prediction.hoursToFull <= 2) reasons.push("متوقع الامتلاء خلال أقل من ساعتين");
    else if (prediction.hoursToFull <= THRESHOLDS.predictedFullSoonHours) reasons.push(`متوقع الامتلاء خلال نحو ${prediction.hoursToFull.toFixed(1)} ساعة`);
  }

  if (hygiene.available && hygiene.wouldTrigger) {
    const txt = `تعرّض حراري ${hygiene.projectedDD} من ${hygiene.limit} درجة-يوم متوقع قبل الجولة القادمة`;
    reasons.push(hygieneActive ? `${txt} — يتجاوز الحد الصحي` : `(وضع المراقبة) ${txt} — كان قيد الحرارة سيرفع أولويتها`);
  }
  if (thermalAlert) reasons.push("تنبيه حراري نشط في الحي");
  if (reportBonus > 0) reasons.push(`${citizenReportCount} بلاغ مواطن مفتوح على هذه الحاوية`);

  if (bin?.lastCollectionAt && timeSinceCollectionComponent >= 60) {
    const days = Math.round((Date.now() - new Date(bin.lastCollectionAt).getTime()) / (HOUR_MS * 24));
    reasons.push(`لم يتم جمعها منذ ${days} يوم تقريبًا`);
  }

  if (sensorHealth.status !== "healthy" && estimatedFill == null) {
    reasons.push("بيانات المستشعر غير مكتملة الموثوقية — الثقة بهذه النتيجة أقل من المعتاد");
  }

  if (reasons.length === 0) reasons.push("جميع المؤشرات ضمن المعدل الطبيعي");

  return { score, tier, reasons, prediction, sensorHealth, hygiene, estimatedFill, trusted: !untrusted };
}

// ══════════════════════════════════════════════════════════════════════
// Neighborhood priority — §9
// ══════════════════════════════════════════════════════════════════════

/**
 * @param {Array<{priority:{score:number,tier:string}, bin:object}>} binPriorities already-scored bins in this neighborhood
 * @param {{thermalAlert?: boolean}} [context]
 */
export function getNeighborhoodPriority(binPriorities = [], context = {}) {
  const { thermalAlert = false, citizenReportCount = 0 } = context;
  const total = binPriorities.length;
  if (total === 0) {
    return { score: 0, tier: "low", reasons: ["لا توجد حاويات مسجلة في هذا الحي بعد"] };
  }

  const criticalCount = binPriorities.filter((b) => b.priority.tier === "critical").length;
  const highCount = binPriorities.filter((b) => b.priority.tier === "high").length;
  const soonCount = binPriorities.filter((b) => b.priority.prediction?.predictionAvailable && b.priority.prediction.hoursToFull <= THRESHOLDS.predictedFullSoonHours).length;
  const offlineCount = binPriorities.filter((b) => b.priority.sensorHealth?.status === "fault" || b.priority.sensorHealth?.connectivity === "offline").length;
  const avgScore = binPriorities.reduce((a, b) => a + b.priority.score, 0) / total;
  const maxScore = Math.max(...binPriorities.map((b) => b.priority.score));
  const fillValues = binPriorities.map((b) => b.bin?.lastFillLevelPercent).filter((v) => v != null && !Number.isNaN(Number(v)) && Number(v) <= 100);
  const avgFill = fillValues.length ? Math.round(fillValues.reduce((a, v) => a + Number(v), 0) / fillValues.length) : null;

  let score = Math.round(0.5 * avgScore + 0.3 * maxScore + 0.2 * (100 * criticalCount) / total);
  if (thermalAlert) score += 10;
  const reportBonus = Math.min(15, Math.max(0, Number(citizenReportCount) || 0) * 5);
  score += reportBonus;
  score = Math.max(0, Math.min(100, score));

  const reasons = [];
  if (criticalCount > 0) reasons.push(`${criticalCount} حاوية في حالة حرجة`);
  if (highCount > 0) reasons.push(`${highCount} حاوية بأولوية مرتفعة`);
  if (soonCount > 0) reasons.push(`${soonCount} حاوية متوقع امتلاؤها قريبًا`);
  if (thermalAlert) reasons.push("تنبيه حراري نشط في الحي");
  if (reportBonus > 0) reasons.push(`${citizenReportCount} بلاغ مواطن مفتوح في الحي`);
  if (offlineCount / total >= 0.5) reasons.push(`${offlineCount} من أصل ${total} حاوية غير متصلة أو بيانات غير موثوقة`);
  if (reasons.length === 0) reasons.push("جميع الحاويات ضمن المعدل الطبيعي");

  return { score, tier: scoreToTier(score), reasons, criticalCount, highCount, soonCount, offlineCount, total, avgScore: Math.round(avgScore), avgFill, citizenReportCount };
}

// ══════════════════════════════════════════════════════════════════════
// Distance — §13 (Haversine, no paid API)
// ══════════════════════════════════════════════════════════════════════

/** Great-circle distance in km. Approximate — not a road-routing distance. */
export function haversineDistanceKm(lat1, lng1, lat2, lng2) {
  if ([lat1, lng1, lat2, lng2].some((v) => v == null || Number.isNaN(Number(v)))) return null;
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ══════════════════════════════════════════════════════════════════════
// Route eligibility — §12
// ══════════════════════════════════════════════════════════════════════

/**
 * @returns {{eligible:boolean, reason:string}}
 */
export function getRouteEligibility(bin, priority) {
  const { sensorHealth } = priority;

  if (sensorHealth.status === "fault") {
    return { eligible: false, reason: "قراءة المستشعر غير موثوقة (Fault) — تحتاج مراجعة يدوية قبل إدراجها" };
  }
  if (sensorHealth.connectivity === "offline" && sensorHealth.connectivity !== "no_sensor") {
    // Offline *with* a last-known reading can still be manually included —
    // this function only governs AUTOMATIC eligibility.
    return { eligible: false, reason: "لا توجد بيانات حديثة كافية (المستشعر غير متصل) — يمكن إضافتها يدويًا" };
  }

  if (priority.tier === "critical" || priority.tier === "high") {
    return { eligible: true, reason: `أولوية ${STATE_LABELS[priority.tier] || priority.tier}` };
  }
  if (priority.prediction?.predictionAvailable && priority.prediction.hoursToFull <= THRESHOLDS.predictedFullSoonHours) {
    return { eligible: true, reason: "متوقع الامتلاء قريبًا" };
  }

  return { eligible: false, reason: "لا تستوفي حاليًا شروط الجمع التلقائي" };
}

// ══════════════════════════════════════════════════════════════════════
// Route recommendation — §11/§14/§15/§16 (MVP: priority + nearest-neighbor)
// ══════════════════════════════════════════════════════════════════════

/**
 * Builds one suggested route PER neighborhood that has ≥1 eligible bin —
 * keeps grouping simple and explainable (same-neighborhood bins are
 * naturally close) rather than a cross-neighborhood VRP.
 *
 * @param {Array<object>} neighborhoods
 * @param {Array<{bin:object, priority:object}>} scoredBins — every bin already scored via getBinPriority
 * @returns {Array<object>} suggested route objects, NOT yet persisted
 */
export function recommendRoutes(neighborhoods = [], scoredBins = []) {
  const byNeighborhood = new Map();
  for (const sb of scoredBins) {
    const nid = sb.bin.neighborhoodId;
    if (!nid) continue;
    const eligibility = getRouteEligibility(sb.bin, sb.priority);
    if (!eligibility.eligible) continue;
    if (!byNeighborhood.has(nid)) byNeighborhood.set(nid, []);
    byNeighborhood.get(nid).push({ ...sb, eligibility });
  }

  const routes = [];
  for (const [neighborhoodId, items] of byNeighborhood.entries()) {
    const neighborhood = neighborhoods.find((n) => n.id === neighborhoodId);
    if (items.length === 0) continue;

    // Order: start at the highest-priority bin, then greedy nearest-neighbor;
    // bins with no coordinates are appended at the end (can't be geo-ordered).
    const withCoords = items.filter((i) => i.bin.lat != null && i.bin.lng != null);
    const withoutCoords = items.filter((i) => i.bin.lat == null || i.bin.lng == null);
    withCoords.sort((a, b) => b.priority.score - a.priority.score);

    const ordered = [];
    const remaining = [...withCoords];
    if (remaining.length > 0) {
      ordered.push(remaining.shift());
      while (remaining.length > 0) {
        const last = ordered[ordered.length - 1];
        let bestIdx = 0;
        let bestScore = -Infinity;
        remaining.forEach((cand, idx) => {
          const dist = haversineDistanceKm(last.bin.lat, last.bin.lng, cand.bin.lat, cand.bin.lng) ?? 999;
          // Weighted: priority first, distance breaks ties / pulls nearby high-priority bins forward.
          const candScore = cand.priority.score * 2 - dist * 10;
          if (candScore > bestScore) { bestScore = candScore; bestIdx = idx; }
        });
        ordered.push(remaining.splice(bestIdx, 1)[0]);
      }
    }
    const finalOrder = [...ordered, ...withoutCoords];

    let estimatedDistanceKm = 0;
    for (let i = 1; i < ordered.length; i++) {
      const d = haversineDistanceKm(ordered[i - 1].bin.lat, ordered[i - 1].bin.lng, ordered[i].bin.lat, ordered[i].bin.lng);
      if (d != null) estimatedDistanceKm += d;
    }

    const estimatedWasteLiters = finalOrder.reduce((sum, i) => {
      const cap = Number(i.bin.capacityLiters) || 1100;
      const fill = Number(i.bin.lastFillLevelPercent) || 0;
      return sum + (cap * fill) / 100;
    }, 0);

    const totalPriorityScore = finalOrder.reduce((s, i) => s + i.priority.score, 0);
    const criticalCount = finalOrder.filter((i) => i.priority.tier === "critical").length;
    const soonCount = finalOrder.filter((i) => i.priority.prediction?.predictionAvailable && i.priority.prediction.hoursToFull <= THRESHOLDS.predictedFullSoonHours).length;

    const reasons = [];
    if (criticalCount > 0) reasons.push(`${criticalCount} حاوية فوق ${THRESHOLDS.fillCriticalPct}%`);
    if (soonCount > 0) reasons.push(`${soonCount} حاوية متوقع امتلاؤها قريبًا`);
    if (withCoords.length > 1) reasons.push("الحاويات متقاربة جغرافيًا داخل نفس الحي");
    reasons.push(`${finalOrder.length} حاوية مؤهلة للجمع في ${neighborhood?.name || "هذا الحي"}`);

    routes.push({
      routeName: `جولة مقترحة - ${neighborhood?.name || "حي غير معروف"}`,
      neighborhoodIds: [neighborhoodId],
      binIds: finalOrder.map((i) => i.bin.id),
      orderedStops: finalOrder.map((i, idx) => ({ order: idx + 1, binId: i.bin.id, binName: i.bin.name, priorityTier: i.priority.tier, priorityScore: i.priority.score, hasCoords: i.bin.lat != null && i.bin.lng != null, lat: i.bin.lat ?? null, lng: i.bin.lng ?? null, fillLevelPercent: i.bin.lastFillLevelPercent ?? null })),
      priorityTier: scoreToTier(Math.round(totalPriorityScore / finalOrder.length)),
      totalPriorityScore,
      estimatedDistanceKm: Math.round(estimatedDistanceKm * 10) / 10,
      estimatedWasteLiters: Math.round(estimatedWasteLiters),
      reasons,
      status: "suggested",
    });
  }

  // Highest-priority neighborhoods first.
  routes.sort((a, b) => b.totalPriorityScore - a.totalPriorityScore);
  return routes;
}

// ══════════════════════════════════════════════════════════════════════
// Route pre-check — §21
// ══════════════════════════════════════════════════════════════════════

/**
 * @param {object} route (with orderedStops[])
 * @param {Array<object>} bins full bin docs for the route's binIds
 * @param {object} [vehicle]
 * @returns {{ready:boolean, issues:string[]}}
 */
export function routePreCheck(route, bins = [], vehicle = null) {
  const issues = [];

  if (!vehicle) {
    issues.push("لم يتم اختيار مركبة بعد");
  } else {
    if (vehicle.status === "maintenance") issues.push("المركبة المختارة في الصيانة");
    else if (vehicle.status === "offline") issues.push("المركبة المختارة غير متصلة");
    else if (vehicle.status === "on_route" && vehicle.currentRouteId && vehicle.currentRouteId !== route.id) issues.push("المركبة المختارة مرتبطة بجولة أخرى نشطة");
  }

  const routeBins = route.binIds.map((id) => bins.find((b) => b.id === id)).filter(Boolean);
  const missingCoords = routeBins.filter((b) => b.lat == null || b.lng == null).length;
  if (missingCoords > 0) issues.push(`${missingCoords} حاوية بلا إحداثيات محددة — سيتم ترتيبها يدويًا في نهاية الجولة`);

  const staleBins = routeBins.filter((b) => {
    if (!b.lastReadingAt) return true;
    return (Date.now() - new Date(b.lastReadingAt).getTime()) / HOUR_MS > THRESHOLDS.offlineTimeoutMin / 60;
  }).length;
  if (staleBins > 0) issues.push(`${staleBins} حاوية بقراءة غير حديثة`);

  const faultBins = routeBins.filter((b) => b.status === "fault").length;
  if (faultBins > 0) issues.push(`${faultBins} حاوية بحالة Fault — تحقق يدويًا قبل الاعتماد`);

  if (vehicle?.capacityLiters && route.estimatedWasteLiters > vehicle.capacityLiters) {
    issues.push(`التقدير الحجمي (${route.estimatedWasteLiters} لتر) يتجاوز سعة المركبة (${vehicle.capacityLiters} لتر)`);
  }

  // Any issue at all means "needs review" per §21 — the UI distinguishes
  // severity by reading the issue text, but readiness itself is binary.
  return { ready: issues.length === 0, issues };
}

// ══════════════════════════════════════════════════════════════════════
// Geometry helpers — pure, dependency-free. Used to place demo bins inside
// a real neighborhood polygon and to measure driver → neighborhood distance.
// ══════════════════════════════════════════════════════════════════════

/** Area-weighted centroid of a GeoJSON Polygon's outer ring → {lat, lng}; vertex average for degenerate rings. */
export function polygonCentroid(geometry) {
  const ring = geometry?.coordinates?.[0];
  if (!ring || ring.length < 3) return null;
  let area = 0, cx = 0, cy = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    const cross = x1 * y2 - x2 * y1;
    area += cross;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  if (Math.abs(area) < 1e-12) {
    return {
      lat: ring.reduce((a, c) => a + c[1], 0) / ring.length,
      lng: ring.reduce((a, c) => a + c[0], 0) / ring.length,
    };
  }
  area *= 0.5;
  return { lng: cx / (6 * area), lat: cy / (6 * area) };
}

/** Ray-casting point-in-polygon against a GeoJSON Polygon's outer ring ([lng, lat] pairs). */
export function pointInPolygon(lat, lng, geometry) {
  const ring = geometry?.coordinates?.[0];
  if (!ring || ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const crosses = (yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

/** Rough urban ETA in minutes — straight-line distance at an assumed average speed, NOT a road-routing estimate. */
export function estimateTravelMinutes(distanceKm, avgSpeedKmh = 30) {
  if (distanceKm == null || Number.isNaN(Number(distanceKm))) return null;
  return Math.max(1, Math.round((Number(distanceKm) / avgSpeedKmh) * 60));
}

// ══════════════════════════════════════════════════════════════════════
// Field routing from a start position — driver portal (§24/§25)
// ══════════════════════════════════════════════════════════════════════

/**
 * Greedy nearest-neighbor ordering that STARTS from an arbitrary point (the
 * driver's / vehicle's current position) instead of from the highest-priority
 * bin — same priority-vs-distance weighting as recommendRoutes(). A pure
 * preview: nothing here persists or dispatches anything.
 *
 * @param {{lat:number,lng:number}|null} start
 * @param {Array<{bin:object, priority:object}>} scoredBins
 * @returns {{orderedStops:Array<object>, totalDistanceKm:number, legs:Array<{toBinId:string, km:number}>}}
 */
export function orderStopsFrom(start, scoredBins = []) {
  const withCoords = scoredBins.filter((s) => s.bin.lat != null && s.bin.lng != null);
  const withoutCoords = scoredBins.filter((s) => s.bin.lat == null || s.bin.lng == null);
  const remaining = [...withCoords];
  const ordered = [];
  const legs = [];
  let cursor = start && start.lat != null && start.lng != null ? { lat: start.lat, lng: start.lng } : null;
  let totalDistanceKm = 0;

  while (remaining.length > 0) {
    let bestIdx = 0, bestScore = -Infinity, bestDist = 0;
    remaining.forEach((cand, idx) => {
      const dist = cursor ? (haversineDistanceKm(cursor.lat, cursor.lng, cand.bin.lat, cand.bin.lng) ?? 999) : 0;
      const candScore = cand.priority.score * 2 - dist * 10;
      if (candScore > bestScore) { bestScore = candScore; bestIdx = idx; bestDist = dist; }
    });
    const next = remaining.splice(bestIdx, 1)[0];
    if (cursor) {
      totalDistanceKm += bestDist;
      legs.push({ toBinId: next.bin.id, km: Math.round(bestDist * 100) / 100 });
    }
    ordered.push(next);
    cursor = { lat: next.bin.lat, lng: next.bin.lng };
  }

  const finalOrder = [...ordered, ...withoutCoords];
  return {
    orderedStops: finalOrder.map((s, idx) => ({
      order: idx + 1, binId: s.bin.id, binName: s.bin.name,
      priorityTier: s.priority.tier, priorityScore: s.priority.score,
      hasCoords: s.bin.lat != null && s.bin.lng != null,
      lat: s.bin.lat ?? null, lng: s.bin.lng ?? null,
      fillLevelPercent: s.bin.lastFillLevelPercent ?? null,
    })),
    totalDistanceKm: Math.round(totalDistanceKm * 10) / 10,
    legs,
  };
}

// ══════════════════════════════════════════════════════════════════════
// "Which neighborhoods need collection NOW?" — one ranked answer shared by
// the dashboard banner, the driver portal and the map (§10/§24)
// ══════════════════════════════════════════════════════════════════════

/**
 * Groups neighborhood docs that share the same normalized name. Duplicates
 * can exist in Firestore (migration run + demo seed), and drawing the same
 * polygon twice lets the empty duplicate's grey hide the real color — so
 * every consumer works on ONE group per real neighborhood and sums its bins
 * across all member docs. The primary doc is the one holding the most bins.
 *
 * @returns {Array<{key:string, name:string, ids:string[], primary:object, members:object[]}>}
 */
export function groupNeighborhoodsByName(neighborhoods = [], bins = []) {
  const binCount = {};
  for (const b of bins) binCount[b.neighborhoodId] = (binCount[b.neighborhoodId] || 0) + 1;

  const groups = new Map();
  for (const n of neighborhoods) {
    const key = normalizeNeighborhoodName(n.name);
    if (!groups.has(key)) groups.set(key, { key, name: n.name, ids: [], primary: n, members: [] });
    const g = groups.get(key);
    g.ids.push(n.id);
    g.members.push(n);
    const better = (binCount[n.id] || 0) > (binCount[g.primary.id] || 0) || ((binCount[n.id] || 0) === (binCount[g.primary.id] || 0) && g.primary.demo && !n.demo);
    if (better) { g.primary = n; g.name = n.name; }
  }
  return [...groups.values()];
}

const OPEN_ROUTE_STATUSES = ["suggested", "approved", "in_progress"];

/** The open (not yet finished) route a bin currently belongs to, if any — a bin is never in two open routes at once. */
export function findOpenRouteForBin(binId, routes = []) {
  return routes.find((r) => OPEN_ROUTE_STATUSES.includes(r.status) && (r.binIds || []).includes(binId)) || null;
}

/**
 * @param {Array<object>} groups from groupNeighborhoodsByName()
 * @param {Array<{bin:object, priority:object}>} scoredBins
 * @param {Array<object>} routes all routes, any status
 * @param {{thermalAlertFor?:(name:string)=>boolean, from?:{lat:number,lng:number}|null, centroidFor?:(group:object)=>({lat:number,lng:number}|null)}} [ctx]
 * @returns {Array<object>} ONLY neighborhoods with ≥1 auto-eligible bin, highest priority first (distance breaks ties)
 */
export function rankNeighborhoodsForCollection(groups = [], scoredBins = [], routes = [], ctx = {}) {
  const { thermalAlertFor = () => false, from = null, centroidFor = () => null } = ctx;
  const openRoutes = routes.filter((r) => OPEN_ROUTE_STATUSES.includes(r.status));

  return groups
    .map((g) => {
      const idSet = new Set(g.ids);
      const nScored = scoredBins.filter((s) => idSet.has(s.bin.neighborhoodId));
      const thermalAlert = thermalAlertFor(g.name);
      const priority = getNeighborhoodPriority(nScored, { thermalAlert });
      const eligibleBins = nScored
        .filter((s) => getRouteEligibility(s.bin, s.priority).eligible)
        .sort((a, b) => b.priority.score - a.priority.score);
      const openRoute = openRoutes.find((r) => (r.neighborhoodIds || []).some((id) => idSet.has(id))) || null;
      const center = centroidFor(g);
      const rawDistance = from && center ? haversineDistanceKm(from.lat, from.lng, center.lat, center.lng) : null;
      return {
        group: g, priority, eligibleBins, openRoute, center, thermalAlert,
        criticalCount: priority.criticalCount || 0,
        highCount: priority.highCount || 0,
        total: priority.total || 0,
        distanceKm: rawDistance != null ? Math.round(rawDistance * 10) / 10 : null,
        etaMinutes: rawDistance != null ? estimateTravelMinutes(rawDistance) : null,
      };
    })
    .filter((x) => x.eligibleBins.length > 0)
    .sort((a, b) => (b.priority.score - a.priority.score) || ((a.distanceKm ?? 999) - (b.distanceKm ?? 999)));
}

// ══════════════════════════════════════════════════════════════════════
// Reconciling fresh recommendations with routes that are already open.
// Keeps the bins ↔ routes link honest: a bin is never in two open routes,
// a suggestion is refreshed in place instead of duplicated, and a
// suggestion whose bins no longer qualify is withdrawn. Approved and
// in-progress routes are never touched — those are human decisions.
// ══════════════════════════════════════════════════════════════════════

function sameIdSet(a = [], b = []) {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

/**
 * @param {Array<object>} neighborhoods
 * @param {Array<{bin:object, priority:object}>} scoredBins every bin, already scored
 * @param {Array<object>} openRoutes routes with status suggested/approved/in_progress
 * @returns {{toCreate:object[], toUpdate:Array<{id:string, data:object}>, toWithdraw:string[], unchanged:string[]}}
 */
export function reconcileRecommendations(neighborhoods = [], scoredBins = [], openRoutes = []) {
  const humanRoutes = openRoutes.filter((r) => r.status === "approved" || r.status === "in_progress");
  const suggested = openRoutes.filter((r) => r.status === "suggested");
  const lockedBinIds = new Set(humanRoutes.flatMap((r) => r.binIds || []));

  const recommended = recommendRoutes(neighborhoods, scoredBins.filter((s) => !lockedBinIds.has(s.bin.id)));

  const toCreate = [];
  const toUpdate = [];
  const unchanged = [];
  const matched = new Set();

  for (const rec of recommended) {
    const nid = rec.neighborhoodIds[0];
    const existing = suggested.find((r) => !matched.has(r.id) && (r.neighborhoodIds || [])[0] === nid);
    if (!existing) { toCreate.push(rec); continue; }
    matched.add(existing.id);

    // Bins an operator added by hand stay in the route even when they are not auto-eligible right now.
    const manualIds = (existing.manualBinIds || []).filter((id) => !rec.binIds.includes(id) && !lockedBinIds.has(id));
    const manualStops = manualIds
      .map((id, i) => {
        const s = scoredBins.find((x) => x.bin.id === id);
        if (!s) return null;
        return { order: rec.orderedStops.length + i + 1, binId: id, binName: s.bin.name, priorityTier: s.priority.tier, priorityScore: s.priority.score, hasCoords: s.bin.lat != null && s.bin.lng != null, manual: true };
      })
      .filter(Boolean);
    const binIds = [...rec.binIds, ...manualStops.map((s) => s.binId)];

    if (sameIdSet(existing.binIds || [], binIds)) { unchanged.push(existing.id); continue; }
    // An operator-optimized order (routeOptimizer) is preserved: still-eligible stops keep their order,
    // newly eligible bins are appended, and the optimization is flagged stale so the UI offers a re-run.
    let orderedStops = [...rec.orderedStops, ...manualStops];
    let optimization;
    if (existing.optimization && Array.isArray(existing.orderedStops)) {
      const keep = existing.orderedStops.filter((s) => binIds.includes(s.binId));
      const keptIds = new Set(keep.map((s) => s.binId));
      const appended = orderedStops.filter((s) => !keptIds.has(s.binId));
      orderedStops = [...keep, ...appended].map((s, i) => ({ ...s, order: i + 1 }));
      optimization = { ...existing.optimization, stale: true, staleReason: appended.length ? `${appended.length} حاوية أُضيفت بعد التحسين` : "تغيّرت الحاويات بعد التحسين" };
    }
    toUpdate.push({
      id: existing.id,
      data: { ...rec, binIds: orderedStops.map((s) => s.binId), orderedStops, manualBinIds: manualStops.map((s) => s.binId), regeneratedAt: new Date().toISOString(), ...(optimization ? { optimization } : {}) },
    });
  }

  const toWithdraw = suggested
    .filter((r) => !matched.has(r.id) && (r.manualBinIds || []).length === 0)
    .map((r) => r.id);

  return { toCreate, toUpdate, toWithdraw, unchanged };
}
