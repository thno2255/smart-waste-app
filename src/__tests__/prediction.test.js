import { describe, it, expect } from "vitest";
import { computeFillRate, predictFullTime, predictFutureState, detectAnomalies, detectCollectionResets } from "../prediction";

const now = Date.now();
const hoursAgo = (h) => new Date(now - h * 3600000).toISOString();

describe("computeFillRate / predictFullTime — §41", () => {
  it("positive, steady fill rate → reliable prediction", () => {
    const readings = [
      { fill_level_percent: 20, timestamp: hoursAgo(6) },
      { fill_level_percent: 35, timestamp: hoursAgo(4) },
      { fill_level_percent: 50, timestamp: hoursAgo(2) },
      { fill_level_percent: 65, timestamp: hoursAgo(0.1) },
    ];
    const rate = computeFillRate(readings);
    expect(rate.reliable).toBe(true);
    expect(rate.ratePerHour).toBeGreaterThan(0);

    const pred = predictFullTime({ lastFillLevelPercent: 65 }, readings);
    expect(pred.predictionAvailable).toBe(true);
    expect(pred.hoursToFull).toBeGreaterThan(0);
    expect(["low", "medium", "high"]).toContain(pred.confidence);
  });

  it("insufficient data (0-1 readings) → predictionAvailable:false, never fabricated", () => {
    expect(predictFullTime({ lastFillLevelPercent: 50 }, []).predictionAvailable).toBe(false);
    expect(predictFullTime({ lastFillLevelPercent: 50 }, [{ fill_level_percent: 50, timestamp: hoursAgo(1) }]).predictionAvailable).toBe(false);
  });

  it("duplicate timestamps are collapsed, not double-counted", () => {
    const t = hoursAgo(1);
    const readings = [
      { fill_level_percent: 40, timestamp: t },
      { fill_level_percent: 42, timestamp: t }, // same timestamp, different value — last one wins
      { fill_level_percent: 55, timestamp: hoursAgo(0.1) },
    ];
    const rate = computeFillRate(readings);
    expect(rate.pointsUsed).toBe(2); // the duplicate collapsed to one point
  });

  it("unordered readings are sorted before computing the rate", () => {
    const ordered = computeFillRate([
      { fill_level_percent: 20, timestamp: hoursAgo(4) },
      { fill_level_percent: 60, timestamp: hoursAgo(0.1) },
      { fill_level_percent: 40, timestamp: hoursAgo(2) },
    ]);
    const shuffled = computeFillRate([
      { fill_level_percent: 60, timestamp: hoursAgo(0.1) },
      { fill_level_percent: 20, timestamp: hoursAgo(4) },
      { fill_level_percent: 40, timestamp: hoursAgo(2) },
    ]);
    expect(shuffled.ratePerHour).toBeCloseTo(ordered.ratePerHour, 5);
  });

  it("a collection reset (big drop) is detected and excluded from the current-trend segment", () => {
    const readings = [
      { fill_level_percent: 70, timestamp: hoursAgo(5) },
      { fill_level_percent: 90, timestamp: hoursAgo(4) },
      { fill_level_percent: 5, timestamp: hoursAgo(3) },  // collected here
      { fill_level_percent: 15, timestamp: hoursAgo(2) },
      { fill_level_percent: 25, timestamp: hoursAgo(0.1) },
    ];
    const resets = detectCollectionResets(readings);
    expect(resets.length).toBe(1);

    const rate = computeFillRate(readings);
    // Rate must reflect the post-reset rise (5→25), not the pre-reset 70→90→5 mess.
    expect(rate.ratePerHour).toBeGreaterThan(0);
    expect(rate.ratePerHour).toBeLessThan(20); // sane post-reset slope, not polluted by the drop
  });

  it("fill decreasing right after a collection is NOT treated as a negative trend", () => {
    const readings = [
      { fill_level_percent: 95, timestamp: hoursAgo(1) },
      { fill_level_percent: 8, timestamp: hoursAgo(0.5) }, // reset
    ];
    const pred = predictFullTime({ lastFillLevelPercent: 8 }, readings);
    // Only one point after the reset — correctly "not enough data", not a fabricated negative-rate prediction.
    expect(pred.predictionAvailable).toBe(false);
  });

  it("noisy/oscillating readings are flagged as anomalies and reduce reliability", () => {
    const readings = [
      { fill_level_percent: 40, timestamp: hoursAgo(5) },
      { fill_level_percent: 70, timestamp: hoursAgo(4) },
      { fill_level_percent: 35, timestamp: hoursAgo(3) },
      { fill_level_percent: 75, timestamp: hoursAgo(2) },
      { fill_level_percent: 30, timestamp: hoursAgo(1) },
      { fill_level_percent: 80, timestamp: hoursAgo(0.1) },
    ];
    const anomalies = detectAnomalies(readings);
    expect(anomalies.some((a) => a.type === "oscillation" || a.type === "unrealistic_jump")).toBe(true);
    expect(computeFillRate(readings).reliable).toBe(false);
  });
});

describe("predictFutureState — §7", () => {
  it("returns a clamped predicted fill level for a reliable rising trend", () => {
    const readings = [
      { fill_level_percent: 10, timestamp: hoursAgo(4) },
      { fill_level_percent: 40, timestamp: hoursAgo(2) },
      { fill_level_percent: 70, timestamp: hoursAgo(0.1) },
    ];
    const future = predictFutureState({ lastFillLevelPercent: 70 }, readings, 3);
    expect(future.predictionAvailable).toBe(true);
    expect(future.predictedFillLevel).toBeLessThanOrEqual(100);
    expect(future.predictedFillLevel).toBeGreaterThanOrEqual(70);
  });

  it("returns predictionAvailable:false with insufficient data instead of guessing", () => {
    const future = predictFutureState({ lastFillLevelPercent: 50 }, [], 6);
    expect(future.predictionAvailable).toBe(false);
    expect(future.predictedFillLevel).toBeNull();
  });
});
