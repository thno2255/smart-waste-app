/**
 * config.js
 * ─────────────────────────────────────────────────────────────────────
 * Centralized thresholds + status logic — single source of truth.
 * Previously these thresholds/status rules were duplicated separately in
 * App.jsx (local getStatus) and firestoreService.js (getStatus/getStatusColor).
 * Both now import from here instead.
 *
 * Pure module: no JSX, no Firestore imports — safe to import from the
 * browser bundle AND from a Node-side Vercel API route (e.g. the future
 * /api/iot/readings endpoint), so status logic never drifts between the
 * client and the server.
 * ─────────────────────────────────────────────────────────────────────
 */

export const THRESHOLDS = {
  fillWarningPct:  60,   // reuses the existing getStatus "تحذير" cutoff
  fillHighPct:     75,   // new Phase-2 tier, between warning and critical — "أولوية مرتفعة"
  fillCriticalPct: 85,   // reuses the existing getStatus "حرج" cutoff
  tempWarningC:    45,
  tempHighC:       52,   // new Phase-2 tier, between warning and critical
  tempCriticalC:   60,   // reuses FireAlertPage's existing alarm line
  tempDangerC:     75,   // reuses FireAlertPage's existing danger line
  offlineTimeoutMin: 30, // no reading within this window => Offline
  faultReadingBounds: { fillMin: 0, fillMax: 100, tempMin: -10, tempMax: 120 },
  predictionWindowHours: 24,

  // Phase 3 — prediction / anomaly detection (src/prediction.js)
  collectionResetDropPct: 30,       // a fill drop ≥ this between readings = the bin was emptied, not "declining"
  maxPlausibleFillRisePerHour: 40,  // a rise faster than this flags an "unrealistic jump"
  maxPlausibleTempJump: 25,         // °C jump between consecutive readings that flags a temperature anomaly
  stuckSensorMinReadings: 5,        // N identical consecutive readings...
  stuckSensorMinHours: 3,           // ...spanning at least this long = "stuck sensor"
  oscillationReversalRatio: 0.6,    // share of direction-reversals that counts as "heavy oscillation"
  minReadingsForReliablePrediction: 3,
  highConfidenceMinReadings: 6,

  // Phase 3 — sensor health (src/sensorHealth.js)
  lowBatteryPct: 15,

  // Phase 3 — decision engine (src/decisionEngine.js)
  predictedFullSoonHours: 3,        // "متوقع الامتلاء قريبًا" / route-eligibility cutoff
  longSinceCollectionHours: 72,     // 3 days — scores the "لم تُجمع منذ فترة طويلة" component at its max
};

export const STATUS_COLORS = {
  normal:   "#10b981", // reuses C.accent
  warning:  "#f59e0b", // reuses C.warning
  critical: "#ef4444", // reuses C.danger
  offline:  "#64748b", // reuses C.dim — the 5th state, not yet used anywhere until bins carry live sensors
  // Added for Phase 2 (neighborhood/bin UI) — additive, does not change the
  // 4 keys above which getStatusColor() (already committed, Phase 1) relies on.
  high:      "#f97316", // distinct orange — "أولوية مرتفعة" tier, between warning and critical
  fault:     "#64748b", // same grey as offline — a faulty sensor is as untrustworthy as a silent one
  no_sensor: "#94a3b8", // slightly lighter grey — "no sensor attached" is not the same as "sensor went quiet"
  // Added for Phase 3 — decisionEngine.js's canonical tier vocabulary is
  // low/medium/high/critical (per spec); these alias the existing
  // normal/warning colors so the SAME StateBadge renders both vocabularies
  // without a translation step at every call site.
  low:    "#10b981", // alias of "normal"
  medium: "#f59e0b", // alias of "warning"
};

/** Arabic labels for the unified state vocabulary used by bins/neighborhoods from Phase 2+ (incl. decisionEngine's low/medium/high/critical tiers). */
export const STATE_LABELS = {
  normal:    "طبيعي",
  warning:   "يحتاج متابعة",
  high:      "أولوية مرتفعة",
  critical:  "حرج",
  offline:   "غير متصل",
  fault:     "خلل بالمستشعر",
  no_sensor: "بدون مستشعر",
  low:       "طبيعي",       // alias of "normal" — decisionEngine's tier vocabulary
  medium:    "يحتاج متابعة", // alias of "warning"
};

/** Confidence labels (prediction.confidence / priority.prediction.confidence). */
export const CONFIDENCE_LABELS = { high: "عالية", medium: "متوسطة", low: "منخفضة" };

/** Route lifecycle status labels (§17) — suggested → approved → in_progress → completed, with rejected/deferred side-branches. */
export const ROUTE_STATUS_LABELS = {
  suggested: "مقترحة",
  approved: "معتمدة",
  in_progress: "نشطة",
  completed: "مكتملة",
  rejected: "مرفوضة",
  deferred: "مؤجَّلة",
  withdrawn: "سُحب الاقتراح", // the engine withdrew its own suggestion (bins no longer qualify) — never applied to approved/active routes
};

/** Vehicle status labels (§19). */
export const VEHICLE_STATUS_LABELS = {
  available: "متاحة",
  on_route: "في جولة",
  maintenance: "صيانة",
  offline: "غير متصلة",
};

/**
 * Fill-level status (Arabic labels, matches existing call sites across the app).
 * Single source of truth — same thresholds/output as the two previously-duplicated copies.
 */
export const getStatus = (fillLevel) => {
  const v = Number(fillLevel) || 0;
  if (v >= THRESHOLDS.fillCriticalPct) return "حرج";
  if (v >= THRESHOLDS.fillWarningPct) return "تحذير";
  return "طبيعي";
};

export const getStatusColor = (fillLevel) => {
  const v = Number(fillLevel) || 0;
  if (v >= THRESHOLDS.fillCriticalPct) return STATUS_COLORS.critical;
  if (v >= THRESHOLDS.fillWarningPct) return STATUS_COLORS.warning;
  return STATUS_COLORS.normal;
};

/**
 * Full bin status including connectivity/fault states.
 * Not wired into any page yet (bins don't carry live sensor readings until
 * later phases) — defined now so the eventual Dashboard/Map/Bins-page cutover
 * has one ready-made function to call instead of re-deriving this logic.
 *
 * @param {{deviceId?: string, lastReadingAt?: string, lastFillLevelPercent?: number}} bin
 * @param {{fill_level_percent?: number, temperature_celsius?: number, timestamp?: string}} [latestReading]
 * @returns {"normal"|"warning"|"critical"|"offline"|"fault"}
 */
export function getBinStatus(bin, latestReading, now = Date.now()) {
  const bounds = THRESHOLDS.faultReadingBounds;

  if (latestReading) {
    const fill = Number(latestReading.fill_level_percent);
    const temp = Number(latestReading.temperature_celsius);
    const outOfRange =
      Number.isNaN(fill) || fill < bounds.fillMin || fill > bounds.fillMax ||
      (latestReading.temperature_celsius != null &&
        (Number.isNaN(temp) || temp < bounds.tempMin || temp > bounds.tempMax));
    if (outOfRange) return "fault";
  }

  const lastReadingAt = latestReading?.timestamp || bin?.lastReadingAt;
  if (lastReadingAt) {
    const ageMin = (now - new Date(lastReadingAt).getTime()) / 60000;
    if (ageMin > THRESHOLDS.offlineTimeoutMin) return "offline";
  } else if (bin?.deviceId) {
    // a device is assigned but has never reported in — treat as offline, not normal
    return "offline";
  }

  const fill = Number(latestReading?.fill_level_percent ?? bin?.lastFillLevelPercent ?? 0);
  const rawTemp = latestReading?.temperature_celsius ?? bin?.lastTemperatureCelsius;
  const temp = rawTemp == null ? null : Number(rawTemp);

  // tempDangerC (75°C) is intentionally not used here — that tier belongs to
  // FireAlertPage's own fire-specific risk scale, not this 4-state bin model.
  if (fill >= THRESHOLDS.fillCriticalPct || (temp != null && temp >= THRESHOLDS.tempCriticalC)) return "critical";
  if (fill >= THRESHOLDS.fillWarningPct || (temp != null && temp >= THRESHOLDS.tempWarningC)) return "warning";
  return "normal";
}

// ══════════════════════════════════════════════════════════════════════
// Phase 2 additions — neighborhood/bin UI helpers.
// These are ADDITIVE: getStatus/getStatusColor/getBinStatus above are left
// untouched (already relied on by committed Phase 1 code), and everything
// below builds a separate, richer vocabulary on top of the same THRESHOLDS.
// ══════════════════════════════════════════════════════════════════════

/**
 * Sensor connectivity only — independent of fill/temperature severity.
 * @returns {"online"|"offline"|"fault"|"no_sensor"}
 */
export function getSensorConnectivity(bin, latestReading, now = Date.now()) {
  if (!bin?.deviceId) return "no_sensor"; // never had a sensor attached — not the same as "went silent"

  const bounds = THRESHOLDS.faultReadingBounds;
  // Check whichever value is actually in play: the explicit latestReading
  // when the caller has one (e.g. right after recordSensorReading), or the
  // bin's own denormalized last-known fields otherwise — which is the ONLY
  // data every list view (Dashboard/Bins/Neighborhoods/Map) has, since none
  // of them fetch per-bin reading history. Without this fallback, a bin
  // resting on an implausible stored value (e.g. 150% fill) would silently
  // flow through as "online" and get clamped into a normal tier instead of
  // being flagged Fault, anywhere the caller didn't also pass a reading.
  const fillSource = latestReading ? latestReading.fill_level_percent : bin?.lastFillLevelPercent;
  const tempSource = latestReading ? latestReading.temperature_celsius : bin?.lastTemperatureCelsius;
  if (fillSource != null || tempSource != null) {
    const fill = fillSource != null ? Number(fillSource) : null;
    const temp = tempSource != null ? Number(tempSource) : null;
    const outOfRange =
      (fill != null && (Number.isNaN(fill) || fill < bounds.fillMin || fill > bounds.fillMax)) ||
      (temp != null && (Number.isNaN(temp) || temp < bounds.tempMin || temp > bounds.tempMax));
    if (outOfRange) return "fault";
  }

  const lastReadingAt = latestReading?.timestamp || bin?.lastReadingAt;
  if (!lastReadingAt) return "offline"; // device assigned, but has never reported in
  const ageMin = (now - new Date(lastReadingAt).getTime()) / 60000;
  return ageMin > THRESHOLDS.offlineTimeoutMin ? "offline" : "online";
}

/**
 * Fill/temperature severity only — independent of connectivity. Returns null
 * when there is no fill or temperature reading at all yet (new/unseeded bin).
 * @returns {"normal"|"warning"|"high"|"critical"|null}
 */
export function getBinTier(bin, latestReading) {
  const rawFill = latestReading?.fill_level_percent ?? bin?.lastFillLevelPercent;
  const fill = rawFill == null ? null : Number(rawFill);
  const rawTemp = latestReading?.temperature_celsius ?? bin?.lastTemperatureCelsius;
  const temp = rawTemp == null ? null : Number(rawTemp);
  if (fill == null && temp == null) return null;

  const fillOk = fill != null && !Number.isNaN(fill);
  const tempOk = temp != null && !Number.isNaN(temp);

  if ((fillOk && fill >= THRESHOLDS.fillCriticalPct) || (tempOk && temp >= THRESHOLDS.tempCriticalC)) return "critical";
  if ((fillOk && fill >= THRESHOLDS.fillHighPct)      || (tempOk && temp >= THRESHOLDS.tempHighC))      return "high";
  if ((fillOk && fill >= THRESHOLDS.fillWarningPct)   || (tempOk && temp >= THRESHOLDS.tempWarningC))   return "warning";
  return "normal";
}

/**
 * Simplified per-bin priority for Phase 2's UI only.
 * NOTE: this is a deliberate placeholder — it just maps connectivity + fill/
 * temp tier to a display label. The real multi-factor Decision Support Engine
 * (fill-rate trend, time-since-last-collection, seasonal events, reasons[])
 * is Phase 3's job and must REPLACE this function's call sites then, not wrap it.
 * @returns {"normal"|"warning"|"high"|"critical"|"offline"|"fault"|"no_sensor"}
 */
export function getSimplePriority(bin, latestReading, now = Date.now()) {
  const connectivity = getSensorConnectivity(bin, latestReading, now);
  if (connectivity !== "online") return connectivity;
  return getBinTier(bin, latestReading) || "normal";
}

/**
 * Aggregate neighborhood status from its bins — deliberately NOT based on
 * average fill alone (per spec): combines critical%/high-warning%/offline%
 * and an optional live thermal-alert flag. Centralized here so no component
 * re-derives this logic independently.
 * @param {Array<object>} bins  — bins already filtered to this neighborhood
 * @param {{thermalAlert?: boolean}} [opts]
 */
export function getNeighborhoodStatus(bins = [], opts = {}) {
  const { thermalAlert = false } = opts;
  const total = bins.length;
  if (total === 0) {
    return { status: "offline", avgFill: null, total: 0, criticalCount: 0, highCount: 0, warningCount: 0, offlineCount: 0, reasons: ["لا توجد حاويات مسجلة في هذا الحي بعد"] };
  }

  let criticalCount = 0, highCount = 0, warningCount = 0, offlineCount = 0;
  const fillValues = [];
  for (const bin of bins) {
    const connectivity = getSensorConnectivity(bin);
    if (connectivity === "offline" || connectivity === "fault") offlineCount += 1;
    if (bin.lastFillLevelPercent != null) fillValues.push(Number(bin.lastFillLevelPercent));

    const tier = getBinTier(bin);
    if (tier === "critical") criticalCount += 1;
    else if (tier === "high") highCount += 1;
    else if (tier === "warning") warningCount += 1;
  }
  const avgFill = fillValues.length ? Math.round(fillValues.reduce((a, v) => a + v, 0) / fillValues.length) : null;
  const offlinePct = offlineCount / total;
  const criticalPct = criticalCount / total;
  const highPct = (criticalCount + highCount) / total;
  const warningPct = (criticalCount + highCount + warningCount) / total;

  const reasons = [];
  let status;
  if (offlinePct >= 0.5) {
    status = "offline";
    reasons.push(`${offlineCount} من أصل ${total} حاوية غير متصلة أو بها خلل`);
  } else if (criticalPct > 0 || thermalAlert) {
    status = "critical";
    if (criticalCount > 0) reasons.push(`${criticalCount} حاوية في حالة حرجة`);
    if (thermalAlert) reasons.push("تنبيه حراري نشط في الحي");
  } else if (highPct >= 0.3) {
    status = "high";
    reasons.push(`${highCount} حاوية بأولوية مرتفعة`);
  } else if (warningPct > 0) {
    status = "warning";
    reasons.push(avgFill != null ? `متوسط الامتلاء ${avgFill}%، و${warningCount} حاوية تحتاج متابعة` : `${warningCount} حاوية تحتاج متابعة`);
  } else {
    status = "normal";
    reasons.push("جميع الحاويات ضمن المعدل الطبيعي");
  }

  if (offlineCount > 0 && status !== "offline") {
    reasons.push(`${offlineCount} حاوية غير متصلة أو بها خلل`);
  }

  return { status, avgFill, total, criticalCount, highCount, warningCount, offlineCount, reasons };
}

/** Human-readable Arabic relative age, e.g. "قبل 8 ثوانٍ" / "لا توجد قراءات بعد". */
export function getReadingAgeLabel(lastReadingAt, now = Date.now()) {
  if (!lastReadingAt) return "لا توجد قراءات بعد";
  const ms = now - new Date(lastReadingAt).getTime();
  if (ms < 0 || ms < 1000) return "الآن";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `قبل ${sec} ثانية`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `قبل ${min} دقيقة`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `قبل ${hr} ساعة`;
  const day = Math.floor(hr / 24);
  return `قبل ${day} يوم`;
}

/** Strips the "حي " prefix for loose matching against demo/real GeoJSON feature names. */
export function normalizeNeighborhoodName(name) {
  return (name || "").replace(/^حي\s+/, "").trim();
}
