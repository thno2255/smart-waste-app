/**
 * savings.js — honest comparison of a plan/realisation against a reference.
 * ─────────────────────────────────────────────────────────────────────
 * A difference is reported with its SIGN and its BASIS. Nothing is clamped:
 * a plan that is longer than its reference is an INCREASE, not "0 saved".
 * Missing data is UNAVAILABLE (null), never 0.
 *
 * Distance bases (what the km figure actually measures):
 *   expected_haversine   planned order, straight-line legs (estimate before execution)
 *   realised_haversine   order actually executed (confirmed collections), straight-line legs — still an estimate
 *   road_network         road-network distance from a routing service (OSRM) — computed, not driven
 *   gps_recorded         distance recorded from the vehicle's GPS track
 *   odometer             distance read from the vehicle's odometer
 * Saving kinds:
 *   expected             before execution
 *   realised_estimate    after execution, but distance still estimated (no GPS / odometer)
 *   realised_measured    after execution with GPS / odometer distance
 *   financial_proven     money saved, from recorded costs — never derived from an estimate
 * Pure module.
 * ─────────────────────────────────────────────────────────────────────
 */
export const DISTANCE_BASIS = {
  EXPECTED_HAVERSINE: "expected_haversine",
  REALISED_HAVERSINE: "realised_haversine",
  ROAD_NETWORK: "road_network",
  GPS_RECORDED: "gps_recorded",
  ODOMETER: "odometer",
};
export const DISTANCE_BASIS_TEXT = {
  expected_haversine: "مسافة متوقعة — تقدير هندسي (خط مستقيم) قبل التنفيذ",
  realised_haversine: "مسافة مقدّرة هندسيًا لترتيب التنفيذ الفعلي — ليست مسافة مسجلة",
  road_network: "مسافة محسوبة من شبكة الطرق — ليست مسافة مقطوعة فعلًا",
  gps_recorded: "مسافة فعلية مسجلة من GPS",
  odometer: "مسافة فعلية من عداد المركبة",
};
export const SAVING_KIND = { EXPECTED: "expected", REALISED_ESTIMATE: "realised_estimate", REALISED_MEASURED: "realised_measured", FINANCIAL_PROVEN: "financial_proven" };
export const SAVING_KIND_TEXT = {
  expected: "وفر متوقع",
  realised_estimate: "أثر متحقق بتقدير المسافة",
  realised_measured: "أثر متحقق بمسافة مسجلة",
  financial_proven: "وفر مالي مثبت",
};

export const OUTCOME = { SAVING: "SAVING", NO_CHANGE: "NO_CHANGE", INCREASE: "INCREASE", UNAVAILABLE: "UNAVAILABLE" };
export const OUTCOME_TEXT = { SAVING: "وفر", NO_CHANGE: "لا تغيّر", INCREASE: "زيادة", UNAVAILABLE: "غير متاح" };

/** Differences smaller than this (km) are reported as "no change". */
export const NO_CHANGE_TOLERANCE_KM = 0.05;

const round1 = (v) => Math.round(v * 10) / 10;

/** Classify a signed difference (positive = saving). */
export function classifyDelta(delta, tolerance = NO_CHANGE_TOLERANCE_KM) {
  if (delta == null || !Number.isFinite(delta)) return OUTCOME.UNAVAILABLE;
  if (Math.abs(delta) < tolerance) return OUTCOME.NO_CHANGE;
  return delta > 0 ? OUTCOME.SAVING : OUTCOME.INCREASE;
}

/**
 * Compare a reference distance with an actual/planned one.
 * @returns {{referenceKm, actualKm, deltaKm, outcome, basis, kind}}  deltaKm > 0 = shorter than the reference.
 */
export function compareDistance(referenceKm, actualKm, { basis, kind } = {}) {
  const ok = referenceKm != null && actualKm != null && Number.isFinite(referenceKm) && Number.isFinite(actualKm);
  const deltaKm = ok ? round1(referenceKm - actualKm) : null;
  return { referenceKm: ok ? round1(referenceKm) : null, actualKm: ok ? round1(actualKm) : null, deltaKm, outcome: classifyDelta(deltaKm), basis: basis || null, kind: kind || null };
}

/** Fuel / CO2 for a SIGNED distance difference (negative = extra consumption). Null factor → null. */
export function fuelOf(deltaKm, fuelLitersPerKm) {
  return deltaKm == null || fuelLitersPerKm == null ? null : round1(deltaKm * fuelLitersPerKm);
}
export function co2Of(fuelL, co2KgPerLiter) {
  return fuelL == null || co2KgPerLiter == null ? null : round1(fuelL * co2KgPerLiter);
}

/** Arabic text for a signed figure: "وفر 3.2 كم" · "زيادة 1.4 كم" · "لا تغيّر" · "غير متاح". */
export function deltaText(delta, unit = "كم", { tolerance = NO_CHANGE_TOLERANCE_KM } = {}) {
  const o = classifyDelta(delta, tolerance);
  if (o === OUTCOME.UNAVAILABLE) return OUTCOME_TEXT.UNAVAILABLE;
  if (o === OUTCOME.NO_CHANGE) return OUTCOME_TEXT.NO_CHANGE;
  const v = Math.abs(delta).toLocaleString("ar-SA");
  return `${o === OUTCOME.SAVING ? "وفر" : "زيادة"} ${v}${unit ? ` ${unit}` : ""}`;
}

/** The financial saving is only ever reported from recorded costs; estimates never become money. */
export const FINANCIAL_NOT_AVAILABLE = { value: null, text: "الوفر المالي غير متاح — لا توجد تكاليف فعلية مسجلة", kind: null };
