/**
 * serviceQuality.js
 * ─────────────────────────────────────────────────────────────────────
 * Service-quality indicators computed ONLY from operational data (bins,
 * server-confirmed collection events, sensor readings) — the replacement for
 * the generated executive figures removed in phase 0. Every indicator states
 * its sample size; with no data it returns null rather than a number.
 *
 * Indicators (from the research paper's evaluation, §5.3):
 *  - fill at emptying: how full bins were when the truck lifted them
 *  - overflow hours: bin-hours spent at ≥ 98 % over the readings window
 *  - hygiene: bins already over / about to pass the degree-day limit
 *  - sensor trust: bins whose fill is estimated because the sensor isn't believed
 * Pure: no Firestore; `now` is an argument.
 * ─────────────────────────────────────────────────────────────────────
 */
import { THRESHOLDS } from "./config.js";
import { getBinPriority } from "./decisionEngine.js";
import { climatologyDailyDD } from "./thermalExposure.js";

const HOUR_MS = 3600000;
const ms = (v) => { const t = v == null ? NaN : new Date(v).getTime(); return Number.isFinite(t) ? t : null; };
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** Fill level at emptying, from server-confirmed collection events in the last `days`. */
export function fillAtCollection(events = [], now = Date.now(), days = 7) {
  const since = now - days * 24 * HOUR_MS;
  const fills = events
    .filter((e) => { const t = ms(e.confirmedAt || e.collectedAt); return t != null && t >= since && t <= now; })
    .map((e) => Number(e.fillBefore)).filter((v) => Number.isFinite(v) && v >= 0);
  if (!fills.length) return { n: 0, median: null, mean: null, lowSharePct: null };
  return {
    n: fills.length,
    median: Math.round(median(fills)),
    mean: Math.round(fills.reduce((a, v) => a + v, 0) / fills.length),
    lowSharePct: Math.round((100 * fills.filter((v) => v < 30).length) / fills.length),
  };
}

/** Bin-hours at ≥ 98 % fill within the readings window, per 100 bins per day. A gap > 2 h is not counted. */
export function overflowHours(readings = [], binCount = 0, windowHours = 24) {
  const byBin = {};
  for (const r of readings) {
    const t = ms(r.timestamp), f = Number(r.fill_level_percent);
    if (t == null || !Number.isFinite(f) || !r.bin_id) continue;
    (byBin[r.bin_id] ||= []).push({ t, f });
  }
  let hours = 0, binsWithData = 0;
  for (const rs of Object.values(byBin)) {
    rs.sort((a, b) => a.t - b.t);
    binsWithData += 1;
    for (let i = 1; i < rs.length; i++) {
      const gap = (rs[i].t - rs[i - 1].t) / HOUR_MS;
      if (gap > 0 && gap <= 2 && rs[i - 1].f >= 98) hours += gap;
    }
  }
  if (!binsWithData || !binCount) return { binsWithData, binHours: null, per100PerDay: null };
  return { binsWithData, binHours: Math.round(hours * 10) / 10, per100PerDay: Math.round(((hours / binsWithData) * 100 * (24 / windowHours)) * 10) / 10 };
}

/**
 * All indicators at once. `scored` may be passed when the caller already ran getBinPriority;
 * otherwise each bin is scored here with its own readings.
 */
export function computeServiceQuality({ bins = [], events = [], readings = [], now = Date.now(), context = () => ({}), scored = null } = {}) {
  const readingsByBin = {};
  for (const r of readings) if (r.bin_id) (readingsByBin[r.bin_id] ||= []).push(r);
  const rows = scored || bins.map((bin) => ({ bin, priority: getBinPriority(bin, null, readingsByBin[bin.id] || [], { ...context(bin), now }) }));
  let hygieneKnown = 0, overLimit = 0, wouldTrigger = 0, untrusted = 0, estimatedCritical = 0, estimatedOverflow = 0;
  for (const { priority: p } of rows) {
    const h = p.hygiene;
    if (h?.available) { hygieneKnown += 1; if (h.overLimit) overLimit += 1; if (h.wouldTrigger) wouldTrigger += 1; }
    if (p.trusted === false) {
      untrusted += 1;
      if (p.estimatedFill != null && p.estimatedFill >= THRESHOLDS.fillCriticalPct) estimatedCritical += 1;
      if (p.estimatedFill != null && p.estimatedFill >= 100) estimatedOverflow += 1;
    }
  }
  const sunDaily = climatologyDailyDD(now, "sun");
  return {
    fillAtCollection: fillAtCollection(events, now),
    overflow: overflowHours(readings, bins.length),
    hygiene: { binsKnown: hygieneKnown, overLimit, wouldTrigger },
    trust: { untrusted, estimatedCritical, estimatedOverflow },
    // seasonal guidance: days a sun-exposed bin of mixed waste can wait before reaching the hygiene limit this month
    season: { dailyDD: Math.round(sunDaily * 10) / 10, daysToLimit: Math.round((THRESHOLDS.hygieneDegreeDays / sunDaily) * 10) / 10 },
  };
}
