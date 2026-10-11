import { describe, it, expect } from "vitest";
import {
  fillBand, getBinMapState, computeNeighborhoodMapStats, binMatchesFilter, neighborhoodMatchesFilter,
  binNeedsCollection, polygonStyle, markerStyle, MAP_STATE_COLORS,
} from "../mapVisual";
import { THRESHOLDS } from "../config";

const now = Date.now();
const minutesAgo = (m) => new Date(now - m * 60000).toISOString();
const bin = (o = {}) => ({ id: "B1", deviceId: "D1", lastFillLevelPercent: 20, lastTemperatureCelsius: 25, lastReadingAt: minutesAgo(2), ...o });
/** readings rising `rate` %/h over the last `hours` hours (n points) */
const risingReadings = (startFill, rate, hours = 4, n = 5) =>
  Array.from({ length: n }, (_, i) => {
    const h = hours - (hours * i) / (n - 1);
    return { bin_id: "B1", fill_level_percent: Math.round(startFill + rate * (hours - h)), timestamp: new Date(now - h * 3600000).toISOString() };
  });

describe("fillBand — bin colors by actual fill", () => {
  it("green < 60, yellow 60–84, red ≥ 85, grey when missing", () => {
    expect(fillBand(0)).toBe("normal");
    expect(fillBand(59)).toBe("normal");
    expect(fillBand(60)).toBe("warning");
    expect(fillBand(84)).toBe("warning");
    expect(fillBand(85)).toBe("critical");
    expect(fillBand(100)).toBe("critical");
    expect(fillBand(null)).toBe("no_data");
    expect(fillBand("abc")).toBe("no_data");
  });
  it("uses THRESHOLDS, not hard-coded numbers", () => {
    expect(fillBand(THRESHOLDS.fillWarningPct)).toBe("warning");
    expect(fillBand(THRESHOLDS.fillCriticalPct)).toBe("critical");
  });
});

describe("getBinMapState — now", () => {
  it("maps fill to the three bands with matching colors", () => {
    expect(getBinMapState(bin({ lastFillLevelPercent: 30 }), { now }).state).toBe("normal");
    expect(getBinMapState(bin({ lastFillLevelPercent: 70 }), { now }).color).toBe(MAP_STATE_COLORS.warning);
    expect(getBinMapState(bin({ lastFillLevelPercent: 90 }), { now }).state).toBe("critical");
  });
  it("offline sensor is its own state, never a fill band — even at 95%", () => {
    const s = getBinMapState(bin({ lastFillLevelPercent: 95, lastReadingAt: minutesAgo(THRESHOLDS.offlineTimeoutMin + 5) }), { now });
    expect(s.state).toBe("offline");
    expect(s.color).not.toBe(MAP_STATE_COLORS.critical);
  });
  it("out-of-range reading → fault (distinct from offline)", () => {
    const s = getBinMapState(bin({ lastFillLevelPercent: 140 }), { now });
    expect(s.state).toBe("fault");
    expect(s.color).not.toBe(MAP_STATE_COLORS.offline);
  });
  it("no fill value → no_data grey", () => {
    expect(getBinMapState({ id: "x", name: "no sensor" }, { now }).state).toBe("no_data");
  });
  it("flags hot bins without changing their fill color", () => {
    const s = getBinMapState(bin({ lastFillLevelPercent: 20, lastTemperatureCelsius: 50 }), { now });
    expect(s.hot).toBe(true);
    expect(s.state).toBe("normal");
  });
});

describe("getBinMapState — future horizons use the prediction engine", () => {
  it("projects fill forward and marks it predicted", () => {
    const b = bin({ lastFillLevelPercent: 60 });
    const s = getBinMapState(b, { horizon: 3, readings: risingReadings(20, 10), now });
    expect(s.predicted).toBe(true);
    expect(s.fill).toBeGreaterThan(80);
    expect(s.actualFill).toBe(60);
    expect(s.state).toBe("critical");
  });
  it("never fabricates: too few readings → no_data with a reason", () => {
    const s = getBinMapState(bin({ lastFillLevelPercent: 60 }), { horizon: 3, readings: [], now });
    expect(s.state).toBe("no_data");
    expect(s.predicted).toBe(false);
    expect(s.forecastReason).toBeTruthy();
  });
  it("offline bins stay offline at every horizon", () => {
    const b = bin({ lastFillLevelPercent: 50, lastReadingAt: minutesAgo(120) });
    expect(getBinMapState(b, { horizon: 6, readings: risingReadings(20, 10), now }).state).toBe("offline");
  });
  it("horizon 0 shows actual readings, not predictions", () => {
    const s = getBinMapState(bin({ lastFillLevelPercent: 30 }), { horizon: 0, readings: risingReadings(20, 10), now });
    expect(s.predicted).toBe(false);
    expect(s.fill).toBe(30);
  });
});

const st = (state, fill = null, extra = {}) => ({ state, fill, predicted: false, ...extra });

describe("computeNeighborhoodMapStats — polygon color algorithm", () => {
  it("empty → no_data", () => {
    expect(computeNeighborhoodMapStats([]).state).toBe("no_data");
  });
  it("excludes offline/fault/no_data from the average and reports how many", () => {
    const r = computeNeighborhoodMapStats([st("normal", 20), st("normal", 40), st("offline", 95), st("fault", 140), st("no_data")]);
    expect(r.avgFill).toBe(30);
    expect(r.validCount).toBe(2);
    expect(r.invalidCount).toBe(3);
    expect(r.reasons.some((x) => x.includes("مستبعدة"))).toBe(true);
  });
  it("only invalid readings → no_data (not green)", () => {
    expect(computeNeighborhoodMapStats([st("offline"), st("no_data")]).state).toBe("no_data");
  });
  it("≥50% disconnected → offline indicator regardless of the rest", () => {
    const r = computeNeighborhoodMapStats([st("critical", 95), st("offline"), st("offline"), st("fault")]);
    expect(r.state).toBe("offline");
  });
  it("critical when ≥30% of valid bins are critical", () => {
    const r = computeNeighborhoodMapStats([st("critical", 90), st("normal", 10), st("normal", 10)]);
    expect(r.criticalRatio).toBeCloseTo(0.33, 1);
    expect(r.state).toBe("critical");
  });
  it("critical when ≥3 critical bins even if the ratio is small", () => {
    const bins = [st("critical", 90), st("critical", 90), st("critical", 90), ...Array.from({ length: 12 }, () => st("normal", 10))];
    expect(computeNeighborhoodMapStats(bins).state).toBe("critical");
  });
  it("critical when the average itself is ≥ 85", () => {
    expect(computeNeighborhoodMapStats([st("warning", 84), st("critical", 86)]).state).toBe("critical");
  });
  it("warning when one critical bin among many, or avg ≥ 60, or half need follow-up", () => {
    const one = [st("critical", 90), ...Array.from({ length: 9 }, () => st("normal", 10))];
    expect(computeNeighborhoodMapStats(one).state).toBe("warning");
    expect(computeNeighborhoodMapStats([st("warning", 65), st("warning", 62)]).state).toBe("warning");
    expect(computeNeighborhoodMapStats([st("warning", 60), st("normal", 10)]).state).toBe("warning");
  });
  it("normal when everything is below 60 and no critical", () => {
    const r = computeNeighborhoodMapStats([st("normal", 10), st("normal", 30), st("warning", 60), st("normal", 5)]);
    expect(r.state).toBe("normal");
  });
  it("counts bins needing emptying (critical + ≥75% warning) and thermal reason", () => {
    const r = computeNeighborhoodMapStats([st("critical", 90), st("warning", 78), st("warning", 62)], { thermalAlert: true });
    expect(r.needsEmptyingCount).toBe(2);
    expect(r.thermalAlert).toBe(true);
    expect(r.reasons.some((x) => x.includes("حراري"))).toBe(true);
  });
  it("tracks how many values are predicted", () => {
    expect(computeNeighborhoodMapStats([st("normal", 10, { predicted: true }), st("normal", 10)]).predictedCount).toBe(1);
  });
});

describe("filters — consistent between bins and polygons", () => {
  const bins = [st("critical", 90), st("warning", 78), st("warning", 62), st("offline"), st("normal", 10)];
  const stats = computeNeighborhoodMapStats(bins, { thermalAlert: false });
  it("critical", () => {
    expect(bins.filter((b) => binMatchesFilter("critical", b)).length).toBe(1);
    expect(neighborhoodMatchesFilter("critical", stats)).toBe(true);
    expect(neighborhoodMatchesFilter("critical", computeNeighborhoodMapStats([st("normal", 10)]))).toBe(false);
  });
  it("offline includes fault", () => {
    expect(binMatchesFilter("offline", st("fault"))).toBe(true);
    expect(binMatchesFilter("offline", st("normal", 10))).toBe(false);
    expect(neighborhoodMatchesFilter("offline", stats)).toBe(true);
  });
  it("needsCollection = critical or warning ≥ 75%", () => {
    expect(binNeedsCollection(st("warning", 78))).toBe(true);
    expect(binNeedsCollection(st("warning", 62))).toBe(false);
    expect(bins.filter((b) => binMatchesFilter("needsCollection", b)).length).toBe(2);
    expect(neighborhoodMatchesFilter("needsCollection", stats)).toBe(true);
    expect(stats.needsEmptyingCount).toBe(2);
  });
  it("thermal uses the neighborhood flag for both", () => {
    expect(binMatchesFilter("thermal", st("normal", 10), { thermalAlert: true })).toBe(true);
    expect(binMatchesFilter("thermal", st("critical", 90), { thermalAlert: false })).toBe(false);
    expect(neighborhoodMatchesFilter("thermal", computeNeighborhoodMapStats(bins, { thermalAlert: true }))).toBe(true);
  });
  it("all matches everything", () => {
    expect(bins.every((b) => binMatchesFilter("all", b))).toBe(true);
    expect(neighborhoodMatchesFilter("all", stats)).toBe(true);
  });
});

describe("styles", () => {
  it("polygon fills are translucent and dimmed when filtered out", () => {
    const s = polygonStyle(computeNeighborhoodMapStats([st("critical", 90)]));
    expect(s.fillOpacity).toBeLessThanOrEqual(0.4);
    expect(s.fillColor).toBe(MAP_STATE_COLORS.critical);
    expect(polygonStyle(computeNeighborhoodMapStats([st("critical", 90)]), { dimmed: true }).fillOpacity).toBeLessThan(0.1);
    expect(polygonStyle(computeNeighborhoodMapStats([st("offline"), st("normal", 10)])).dashArray).toBe("6 6");
  });
  it("predicted markers are dashed; offline markers are hollow", () => {
    expect(markerStyle(st("critical", 90, { predicted: true })).dashArray).toBe("3 3");
    expect(markerStyle(st("offline", null, { color: MAP_STATE_COLORS.offline })).fillColor).toBe("#ffffff");
  });
});
