import { describe, it, expect } from "vitest";
import {
  degreeDays, climatologyDailyDD, advanceExposure, computeExposure, expectedDailyDD,
  hygieneRisk, nextStoredExposure, exposureApplies, BURAYDAH_DAILY_DD, SOLAR_MEAN_GAIN_C,
} from "../thermalExposure";
import { THRESHOLDS } from "../config";

const H = 3600000;
const AUG = Date.UTC(2025, 7, 10, 12);   // 10 Aug 2025 12:00 UTC
const JAN = Date.UTC(2025, 0, 10, 12);
const iso = (t) => new Date(t).toISOString();
const bin = (o = {}) => ({ id: "B1", wasteType: "مختلط", exposure: "sun", ...o });
const readingsAt = (start, hours, tempC) => Array.from({ length: hours }, (_, i) => ({ timestamp: iso(start + (i + 1) * H), temperature_celsius: tempC }));

describe("degree-day arithmetic", () => {
  it("counts only the part above the fly development threshold", () => {
    expect(degreeDays(THRESHOLDS.thermalBaseC + 24, 24)).toBeCloseTo(24);
    expect(degreeDays(10, 24)).toBe(0);
    expect(degreeDays(THRESHOLDS.thermalBaseC + 12, 12)).toBeCloseTo(6);
  });

  it("climatology: August is ~10× January, sun adds more than shade", () => {
    expect(climatologyDailyDD(AUG, "sun")).toBeCloseTo(BURAYDAH_DAILY_DD[7] + SOLAR_MEAN_GAIN_C.sun);
    expect(climatologyDailyDD(AUG, "sun") / climatologyDailyDD(JAN, "sun")).toBeGreaterThan(3.5);
    expect(climatologyDailyDD(AUG, "shade")).toBeLessThan(climatologyDailyDD(AUG, "sun"));
  });

  it("a probe value is trusted for at most thermalMaxGapHours; the rest comes from climatology", () => {
    const s = advanceExposure({ dd: 0, at: AUG }, { tempC: 40, to: AUG + 24 * H, exposure: "sun" });
    expect(s.probeHours).toBe(THRESHOLDS.thermalMaxGapHours);
    expect(s.climHours).toBe(24 - THRESHOLDS.thermalMaxGapHours);
  });
});

describe("computeExposure", () => {
  it("is unavailable without a known emptying time", () => {
    expect(computeExposure(bin(), [], AUG).available).toBe(false);
  });

  it("integrates hourly probe readings since the last emptying", () => {
    const start = AUG - 24 * H;
    const b = bin({ lastCollectionAt: iso(start), lastReadingAt: iso(AUG), lastTemperatureCelsius: 36.42 });
    const e = computeExposure(b, readingsAt(start, 24, 36.42), AUG);
    expect(e.available).toBe(true);
    expect(e.dd).toBeCloseTo(24, 1);            // 24 °C above T0 for one day
    expect(e.source).toBe("probe");
  });

  it("ignores readings from before the last emptying", () => {
    const start = AUG - 6 * H;
    const old = readingsAt(AUG - 48 * H, 40, 60);
    const b = bin({ lastCollectionAt: iso(start), lastReadingAt: iso(AUG), lastTemperatureCelsius: 20 });
    const e = computeExposure(b, [...old, ...readingsAt(start, 6, 20)], AUG);
    expect(e.dd).toBeCloseTo((20 - THRESHOLDS.thermalBaseC) * 6 / 24, 2);
  });

  it("uses the server running total when it is newer than the emptying", () => {
    const b = bin({ lastCollectionAt: iso(AUG - 48 * H), thermalExposureDD: 30, thermalExposureAt: iso(AUG - 1 * H), lastReadingAt: iso(AUG - 1 * H), lastTemperatureCelsius: 36.42 });
    expect(computeExposure(b, [], AUG).dd).toBeCloseTo(30 + 1, 1);
  });

  it("falls back to climatology when there is no probe data at all", () => {
    const b = bin({ lastCollectionAt: iso(AUG - 48 * H) });
    const e = computeExposure(b, [], AUG);
    expect(e.source).toBe("climatology");
    expect(e.dd).toBeCloseTo(2 * climatologyDailyDD(AUG - 48 * H, "sun"), 0);
  });
});

describe("hygieneRisk — summer vs winter", () => {
  it("summer: a bin emptied 40 h ago will pass the limit before the next run", () => {
    const b = bin({ lastCollectionAt: iso(AUG - 40 * H) });
    const r = hygieneRisk(b, [], AUG);
    expect(r.available).toBe(true);
    expect(r.wouldTrigger).toBe(true);
  });

  it("winter: the same bin is far from the limit", () => {
    const b = bin({ lastCollectionAt: iso(JAN - 40 * H) });
    const r = hygieneRisk(b, [], JAN);
    expect(r.wouldTrigger).toBe(false);
    expect(r.projectedRatio).toBeLessThan(0.5);
  });

  it("dry waste is exempt", () => {
    expect(exposureApplies(bin({ wasteType: "ورق" }))).toBe(false);
    expect(hygieneRisk(bin({ wasteType: "ورق", lastCollectionAt: iso(AUG - 72 * H) }), [], AUG).applies).toBe(false);
  });

  it("the next-day rate prefers dense recent probe data over climatology", () => {
    const r = expectedDailyDD(bin(), readingsAt(AUG - 24 * H, 24, 22.42), AUG);
    expect(r.source).toBe("probe");
    expect(r.perDay).toBeCloseTo(10);
  });
});

describe("nextStoredExposure (ingest running total)", () => {
  it("restarts from the last emptying and advances with the new reading", () => {
    const b = bin({ lastCollectionAt: iso(AUG - 2 * H), thermalExposureDD: 99, thermalExposureAt: iso(AUG - 30 * H) });
    const u = nextStoredExposure(b, 36.42, iso(AUG));
    expect(u.thermalExposureDD).toBeCloseTo(2, 2);   // the old total belongs to the previous load
    expect(u.thermalExposureAt).toBe(iso(AUG));
  });

  it("returns null without an emptying time or for an out-of-order reading", () => {
    expect(nextStoredExposure(bin(), 30, iso(AUG))).toBeNull();
    const b = bin({ lastCollectionAt: iso(AUG - 2 * H), thermalExposureDD: 1, thermalExposureAt: iso(AUG) });
    expect(nextStoredExposure(b, 30, iso(AUG - H))).toBeNull();
  });
});
