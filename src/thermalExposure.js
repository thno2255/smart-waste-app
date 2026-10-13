/**
 * thermalExposure.js
 * ─────────────────────────────────────────────────────────────────────
 * Heat-hygiene model. In Qassim the waste in a bin can become a fly-breeding
 * and odour problem long before the bin is full, so "collect when full" is
 * not enough. The exposure of the waste since the last emptying is measured in
 * DEGREE-DAYS above the house-fly development threshold (T0 = 12.42 °C):
 *
 *     E = Σ max(0, T_in − T0) · Δt / 24 h
 *
 * and compared with a hygiene limit DD* (THRESHOLDS.hygieneDegreeDays). DD* is
 * derived from laboratory fly development, not measured in Buraydah bins — the
 * model therefore ships in "observe" mode first (see heatModelMode).
 *
 * Temperature sources, in order: the bin's own probe (sensor readings or the
 * server-maintained running total), then a monthly Buraydah climatology
 * (ERA5 2023–2025) plus a mean solar gain for sun-exposed bins. Pure: no
 * Firestore, no clock reads except the `now` argument.
 * ─────────────────────────────────────────────────────────────────────
 */
import { THRESHOLDS } from "./config.js";

const HOUR_MS = 3600000;

/** Mean daily degree-days above T0 of the AIR in Buraydah, Jan..Dec (ERA5 hourly, 2023–2025). */
export const BURAYDAH_DAILY_DD = [2.5, 3.4, 8.0, 13.1, 19.3, 23.1, 24.1, 24.5, 21.7, 15.3, 8.3, 4.3];
/** Mean extra °C inside a bin over 24 h from sunshine (peak gain 10 °C sun / 4 °C shade on a half-sine day). */
export const SOLAR_MEAN_GAIN_C = { sun: 3.45, shade: 1.38 };
/** Waste types with no food fraction — the hygiene rule does not apply to them. */
const DRY_WASTE = new Set(["جاف", "ورق", "كرتون", "زجاج", "معادن", "بلاستيك", "dry", "paper", "glass", "metal", "plastic"]);

const ms = (v) => { const t = v == null ? NaN : new Date(v).getTime(); return Number.isFinite(t) ? t : null; };
const exposureClass = (bin) => (bin?.exposure === "shade" ? "shade" : "sun"); // unknown → sun (the cautious default)

export const exposureApplies = (bin) => !DRY_WASTE.has(String(bin?.wasteType || "").trim());

/** Degree-days accumulated over `hours` at a constant in-bin temperature. */
export const degreeDays = (tempC, hours) => Math.max(0, Number(tempC) - THRESHOLDS.thermalBaseC) * (hours / 24);

/** Climatological degree-days per day for a date and exposure. */
export function climatologyDailyDD(atMs, exposure = "sun") {
  const m = new Date(atMs).getUTCMonth();
  return BURAYDAH_DAILY_DD[m] + (SOLAR_MEAN_GAIN_C[exposure] ?? SOLAR_MEAN_GAIN_C.sun);
}

/**
 * Advance a running exposure {dd, at} to time `to`. A known probe temperature is
 * trusted for at most thermalMaxGapHours; any longer gap is filled from climatology.
 * @returns {{dd:number, at:number, probeHours:number, climHours:number}}
 */
export function advanceExposure(state, { tempC = null, to, exposure = "sun" }) {
  const hours = (to - state.at) / HOUR_MS;
  if (!(hours > 0)) return { ...state, probeHours: state.probeHours || 0, climHours: state.climHours || 0 };
  const known = tempC != null && Number.isFinite(Number(tempC)) ? Math.min(hours, THRESHOLDS.thermalMaxGapHours) : 0;
  const rest = hours - known;
  const dd = state.dd + (known ? degreeDays(tempC, known) : 0) + (rest ? climatologyDailyDD(state.at, exposure) * (rest / 24) : 0);
  return { dd, at: to, probeHours: (state.probeHours || 0) + known, climHours: (state.climHours || 0) + rest };
}

/**
 * Exposure of the waste currently in the bin.
 * Uses the server running total (bins.thermalExposureDD/At, maintained by /api/iot/readings) when it is
 * newer than the last emptying; otherwise integrates the given readings, climatology filling the gaps.
 */
export function computeExposure(bin, readings = [], now = Date.now()) {
  const start = ms(bin?.lastCollectionAt);
  if (start == null) return { available: false, reason: "لا يُعرف وقت آخر تفريغ لهذه الحاوية" };
  const exposure = exposureClass(bin);
  let state;
  const runAt = ms(bin?.thermalExposureAt);
  if (runAt != null && runAt >= start && Number.isFinite(Number(bin?.thermalExposureDD))) {
    state = { dd: Number(bin.thermalExposureDD), at: runAt, probeHours: (runAt - start) / HOUR_MS, climHours: 0 };
  } else {
    state = { dd: 0, at: start, probeHours: 0, climHours: 0 };
    const rs = readings
      .map((r) => ({ t: ms(r.timestamp), temp: r.temperature_celsius == null ? null : Number(r.temperature_celsius) }))
      .filter((r) => r.t != null && r.t > start && r.t <= now && r.temp != null && Number.isFinite(r.temp))
      .sort((a, b) => a.t - b.t);
    // each reading's temperature stands for the interval that ends at it
    for (const r of rs) state = advanceExposure(state, { tempC: r.temp, to: r.t, exposure });
  }
  const lastT = ms(bin?.lastReadingAt);
  const lastTemp = bin?.lastTemperatureCelsius;
  const tailTemp = lastT != null && now - lastT <= THRESHOLDS.thermalMaxGapHours * HOUR_MS ? lastTemp : null;
  state = advanceExposure(state, { tempC: tailTemp, to: now, exposure });
  const total = state.probeHours + state.climHours;
  const source = total <= 0 ? "probe" : state.climHours / total < 0.1 ? "probe" : state.probeHours / total < 0.1 ? "climatology" : "mixed";
  return { available: true, dd: state.dd, hoursSinceCollection: (now - start) / HOUR_MS, source };
}

/** Expected degree-days per day for the next day: the probe's recent mean if dense enough, else climatology. */
export function expectedDailyDD(bin, readings = [], now = Date.now()) {
  const since = now - 24 * HOUR_MS;
  const temps = readings
    .filter((r) => { const t = ms(r.timestamp); return t != null && t >= since && t <= now && r.temperature_celsius != null; })
    .map((r) => Number(r.temperature_celsius)).filter(Number.isFinite);
  if (temps.length >= 6) {
    // mean of the per-reading degree-day rates (not of temperatures): nights below T0 contribute 0
    return { perDay: temps.reduce((a, t) => a + Math.max(0, t - THRESHOLDS.thermalBaseC), 0) / temps.length, source: "probe" };
  }
  return { perDay: climatologyDailyDD(now, exposureClass(bin)), source: "climatology" };
}

/**
 * Hygiene risk for the priority engine: current exposure and the exposure the waste
 * will have reached by the next opportunity (`horizonHours`, default one day).
 */
export function hygieneRisk(bin, readings = [], now = Date.now(), horizonHours = 24) {
  const limit = THRESHOLDS.hygieneDegreeDays;
  if (!exposureApplies(bin)) return { applies: false, available: false, limit, reason: "نوع النفايات جاف — القيد الصحي لا ينطبق" };
  const cur = computeExposure(bin, readings, now);
  if (!cur.available) return { applies: true, available: false, limit, reason: cur.reason };
  const rate = expectedDailyDD(bin, readings, now);
  const projectedDD = cur.dd + rate.perDay * (horizonHours / 24);
  const ratio = cur.dd / limit, projectedRatio = projectedDD / limit;
  return {
    applies: true, available: true, limit,
    dd: Math.round(cur.dd * 10) / 10, projectedDD: Math.round(projectedDD * 10) / 10,
    ratio, projectedRatio, overLimit: ratio >= 1, wouldTrigger: projectedRatio >= 1,
    hoursSinceCollection: cur.hoursSinceCollection, source: cur.source, rateSource: rate.source,
  };
}

/** Running total for the ingest route: advance the bin's stored exposure with a new probe reading. */
export function nextStoredExposure(bin, tempC, atIso) {
  const at = ms(atIso);
  const start = ms(bin?.lastCollectionAt);
  if (at == null || start == null) return null;
  const runAt = ms(bin?.thermalExposureAt);
  const base = runAt != null && runAt >= start && Number.isFinite(Number(bin?.thermalExposureDD))
    ? { dd: Number(bin.thermalExposureDD), at: runAt } : { dd: 0, at: start };
  if (at <= base.at) return null;
  const next = advanceExposure(base, { tempC, to: at, exposure: exposureClass(bin) });
  return { thermalExposureDD: Math.round(next.dd * 1000) / 1000, thermalExposureAt: new Date(at).toISOString() };
}
