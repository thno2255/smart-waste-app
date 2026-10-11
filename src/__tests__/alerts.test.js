import { describe, it, expect } from "vitest";
import { getBinPriority } from "../decisionEngine";
import { generateAlertCandidates, ALERT_TYPES } from "../alertsEngine";

const now = Date.now();
const minutesAgo = (m) => new Date(now - m * 60000).toISOString();
const hoursAgo = (h) => new Date(now - h * 3600000).toISOString();

function bin(id, overrides = {}) {
  return { id, name: `حاوية ${id}`, deviceId: `DEV-${id}`, lastFillLevelPercent: 20, lastTemperatureCelsius: 25, lastReadingAt: minutesAgo(1), ...overrides };
}

describe("generateAlertCandidates — §43", () => {
  it("critical bin → bin_critical candidate", () => {
    const b = bin("B1", { lastFillLevelPercent: 92 });
    const candidates = generateAlertCandidates([{ bin: b, priority: getBinPriority(b, null, []) }], []);
    expect(candidates.some((c) => c.type === ALERT_TYPES.BIN_CRITICAL && c.sourceId === "B1")).toBe(true);
  });

  it("active thermal context on a neighborhood → neighborhood_critical when the neighborhood scores critical", () => {
    const b = bin("B1", { lastFillLevelPercent: 92 });
    const priority = getBinPriority(b, null, [], { thermalAlert: true });
    const neighborhood = { id: "N1", name: "حي الريان" };
    const nPriority = { tier: "critical", criticalCount: 1, total: 1 };
    const candidates = generateAlertCandidates(
      [{ bin: b, priority }],
      [{ neighborhood, priority: nPriority }]
    );
    expect(candidates.some((c) => c.type === ALERT_TYPES.NEIGHBORHOOD_CRITICAL && c.sourceId === "N1")).toBe(true);
    expect(priority.reasons.some((r) => r.includes("حراري"))).toBe(true); // the thermal context is reflected in the bin's own reasons
  });

  it("offline sensor → sensor_offline candidate", () => {
    const b = bin("B1", { lastFillLevelPercent: 50, lastReadingAt: minutesAgo(90) });
    const candidates = generateAlertCandidates([{ bin: b, priority: getBinPriority(b, null, []) }], []);
    expect(candidates.some((c) => c.type === ALERT_TYPES.SENSOR_OFFLINE)).toBe(true);
  });

  it("fault reading → sensor_fault candidate, not sensor_offline", () => {
    const b = bin("B1", { lastFillLevelPercent: 50 });
    const latestReading = { fill_level_percent: 150, timestamp: minutesAgo(1) };
    const priority = getBinPriority(b, latestReading, []);
    const candidates = generateAlertCandidates([{ bin: b, priority }], []);
    expect(candidates.some((c) => c.type === ALERT_TYPES.SENSOR_FAULT)).toBe(true);
    expect(candidates.some((c) => c.type === ALERT_TYPES.SENSOR_OFFLINE)).toBe(false);
  });

  it("rising readings predicting a soon-full bin → predicted_full_soon candidate", () => {
    const readings = [
      { fill_level_percent: 60, timestamp: hoursAgo(2) },
      { fill_level_percent: 80, timestamp: hoursAgo(1) },
      { fill_level_percent: 95, timestamp: minutesAgo(1) },
    ];
    const b = bin("B1", { lastFillLevelPercent: 95 });
    const priority = getBinPriority(b, null, readings);
    const candidates = generateAlertCandidates([{ bin: b, priority }], []);
    expect(candidates.some((c) => c.type === ALERT_TYPES.PREDICTED_FULL_SOON)).toBe(true);
  });

  it("deduplication contract: the same bin state always produces the same dedupKey across repeated calls", () => {
    const b = bin("B1", { lastFillLevelPercent: 92 });
    const priority = getBinPriority(b, null, []);
    const run1 = generateAlertCandidates([{ bin: b, priority }], []);
    const run2 = generateAlertCandidates([{ bin: b, priority }], []);
    const keys1 = run1.map((c) => c.dedupKey).sort();
    const keys2 = run2.map((c) => c.dedupKey).sort();
    expect(keys1).toEqual(keys2);
    expect(new Set(keys1).size).toBe(keys1.length); // no duplicate keys within a single run either
  });
});
