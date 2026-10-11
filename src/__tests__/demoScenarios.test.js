/**
 * Demo Mode has no separate "engine" of its own (§32) — it applies the same
 * bin/reading shapes the real pipeline uses, so these tests exercise the
 * actual downstream chain (status → priority → alerts → route) with each
 * demo action's resulting state, proving a demo action genuinely propagates
 * through the system rather than just toggling a cosmetic label.
 */
import { describe, it, expect } from "vitest";
import { getSensorConnectivity, getBinTier } from "../config";
import { getBinPriority, getRouteEligibility, recommendRoutes } from "../decisionEngine";
import { generateAlertCandidates, ALERT_TYPES } from "../alertsEngine";

const now = Date.now();
const minutesAgo = (m) => new Date(now - m * 60000).toISOString();

function demoBin(overrides = {}) {
  return {
    id: "DEMO-1", name: "حاوية العرض التجريبي", neighborhoodId: "N1", demo: true,
    deviceId: "DEV-DEMO", lastFillLevelPercent: 20, lastTemperatureCelsius: 25,
    lastReadingAt: minutesAgo(1), lat: 26.33, lng: 43.97, capacityLiters: 1100,
    ...overrides,
  };
}

describe("Demo Mode action → downstream effects — §44", () => {
  it("'تغيير fill' to a critical value raises tier, priority score, and triggers a bin_critical alert + eligible route", () => {
    const before = demoBin({ lastFillLevelPercent: 55 });
    const after = demoBin({ lastFillLevelPercent: 92 });

    const beforePriority = getBinPriority(before, null, []);
    const afterPriority = getBinPriority(after, null, []);
    expect(afterPriority.score).toBeGreaterThan(beforePriority.score);
    expect(afterPriority.tier).toBe("critical");

    const candidates = generateAlertCandidates([{ bin: after, priority: afterPriority }], []);
    expect(candidates.some((c) => c.type === ALERT_TYPES.BIN_CRITICAL)).toBe(true);

    expect(getRouteEligibility(after, afterPriority).eligible).toBe(true);
    const routes = recommendRoutes([{ id: "N1", name: "حي العرض" }], [{ bin: after, priority: afterPriority }]);
    expect(routes.length).toBe(1);
  });

  it("'تغيير temperature' to a critical value escalates tier even at low fill and triggers temperature_critical", () => {
    const after = demoBin({ lastFillLevelPercent: 15, lastTemperatureCelsius: 68 });
    const priority = getBinPriority(after, null, []);
    expect(priority.tier).not.toBe("low");

    const candidates = generateAlertCandidates([{ bin: after, priority }], []);
    expect(candidates.some((c) => c.type === ALERT_TYPES.TEMPERATURE_CRITICAL)).toBe(true);
  });

  it("'جعل sensor offline' flips connectivity to offline and demotes auto route-eligibility", () => {
    const offlineBin = demoBin({ lastFillLevelPercent: 90, lastReadingAt: minutesAgo(90) });
    expect(getSensorConnectivity(offlineBin)).toBe("offline");

    const priority = getBinPriority(offlineBin, null, []);
    expect(priority.sensorHealth.connectivity).toBe("offline");
    expect(getRouteEligibility(offlineBin, priority).eligible).toBe(false);

    const candidates = generateAlertCandidates([{ bin: offlineBin, priority }], []);
    expect(candidates.some((c) => c.type === ALERT_TYPES.SENSOR_OFFLINE)).toBe(true);
  });

  it("'عمل fault' (implausible reading) flags sensor health as fault and excludes the bin from auto-routing", () => {
    const faultBin = demoBin({ lastFillLevelPercent: 90 });
    const faultReading = { fill_level_percent: 240, timestamp: minutesAgo(1) };
    const priority = getBinPriority(faultBin, faultReading, []);
    expect(priority.sensorHealth.status).toBe("fault");
    expect(getRouteEligibility(faultBin, priority).eligible).toBe(false);

    const candidates = generateAlertCandidates([{ bin: faultBin, priority }], []);
    expect(candidates.some((c) => c.type === ALERT_TYPES.SENSOR_FAULT)).toBe(true);
  });

  it("'reset demo' (back to a quiet normal bin) clears all alert candidates and critical tiering", () => {
    const resetBin = demoBin({ lastFillLevelPercent: 15, lastTemperatureCelsius: 24, lastReadingAt: minutesAgo(1) });
    const priority = getBinPriority(resetBin, null, []);
    expect(priority.tier).toBe("low");
    expect(generateAlertCandidates([{ bin: resetBin, priority }], [])).toEqual([]);
  });

  it("'simulate new reading' (a fresh timely reading) returns the sensor to online even if it was previously stale", () => {
    const staleBin = demoBin({ lastReadingAt: minutesAgo(90) });
    expect(getSensorConnectivity(staleBin)).toBe("offline");

    const freshReading = { fill_level_percent: 70, temperature_celsius: 30, timestamp: minutesAgo(0.1) };
    expect(getSensorConnectivity(staleBin, freshReading)).toBe("online");
    expect(getBinTier(staleBin, freshReading)).not.toBeNull();
  });

  it("suggested-route regeneration: a route that existed while critical disappears once the bin is no longer eligible", () => {
    const critical = demoBin({ lastFillLevelPercent: 92 });
    const criticalPriority = getBinPriority(critical, null, []);
    const routesBefore = recommendRoutes([{ id: "N1", name: "حي العرض" }], [{ bin: critical, priority: criticalPriority }]);
    expect(routesBefore.length).toBe(1);

    const resolved = demoBin({ lastFillLevelPercent: 15 });
    const resolvedPriority = getBinPriority(resolved, null, []);
    const routesAfter = recommendRoutes([{ id: "N1", name: "حي العرض" }], [{ bin: resolved, priority: resolvedPriority }]);
    expect(routesAfter.length).toBe(0);
  });
});
