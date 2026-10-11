import { describe, it, expect } from "vitest";
import { getBinPriority } from "../decisionEngine";

const now = Date.now();
const minutesAgo = (m) => new Date(now - m * 60000).toISOString();

function bin(overrides = {}) {
  return {
    id: "BIN-1", deviceId: "DEV-1",
    lastFillLevelPercent: 20, lastTemperatureCelsius: 25,
    lastReadingAt: minutesAgo(1),
    ...overrides,
  };
}

describe("getBinPriority — §40", () => {
  it("fill طبيعي → low tier", () => {
    const b = bin({ lastFillLevelPercent: 20 });
    const r = getBinPriority(b, null, []);
    expect(r.tier).toBe("low");
    expect(r.score).toBeLessThan(30);
  });

  it("fill warning (60-74%) → medium tier", () => {
    const b = bin({ lastFillLevelPercent: 65 });
    const r = getBinPriority(b, null, []);
    expect(["medium", "high"]).toContain(r.tier);
    expect(r.reasons.some((x) => x.includes("65"))).toBe(true);
  });

  it("fill critical (>=85%) → critical tier with a fill reason", () => {
    const b = bin({ lastFillLevelPercent: 92 });
    const r = getBinPriority(b, null, []);
    expect(r.tier).toBe("critical");
    expect(r.reasons.some((x) => x.includes("92"))).toBe(true);
  });

  it("temperature critical escalates tier even with low fill", () => {
    const low = getBinPriority(bin({ lastFillLevelPercent: 10, lastTemperatureCelsius: 25 }), null, []);
    const hot = getBinPriority(bin({ lastFillLevelPercent: 10, lastTemperatureCelsius: 65 }), null, []);
    expect(hot.score).toBeGreaterThan(low.score);
    expect(hot.reasons.some((x) => x.includes("حرارة"))).toBe(true);
  });

  it("predicted-full-soon raises score via a rising reading trend", () => {
    const readings = [
      { fill_level_percent: 40, timestamp: minutesAgo(120) },
      { fill_level_percent: 60, timestamp: minutesAgo(60) },
      { fill_level_percent: 80, timestamp: minutesAgo(1) },
    ];
    const r = getBinPriority(bin({ lastFillLevelPercent: 80 }), null, readings);
    expect(r.prediction.predictionAvailable).toBe(true);
    expect(r.reasons.some((x) => x.includes("متوقع الامتلاء"))).toBe(true);
  });

  it("offline sensor discounts confidence but keeps last-known severity, with a reason noting it", () => {
    const b = bin({ lastFillLevelPercent: 90, lastReadingAt: minutesAgo(90) }); // past offlineTimeoutMin (30)
    const r = getBinPriority(b, null, []);
    expect(r.sensorHealth.connectivity).toBe("offline");
    expect(r.tier).not.toBe("low");
    expect(r.reasons.some((x) => x.includes("موثوقية"))).toBe(true);
  });

  it("fault reading (out of range) is flagged and discounted", () => {
    const b = bin({ lastFillLevelPercent: 150 }); // out of bounds
    const latestReading = { fill_level_percent: 150, temperature_celsius: 25, timestamp: minutesAgo(1) };
    const r = getBinPriority(b, latestReading, []);
    expect(r.sensorHealth.status).toBe("fault");
  });

  it("regression: a bin resting on an out-of-range denormalized value is still flagged Fault even with no latestReading passed — this is the call shape every list view (Dashboard/Bins/Map) actually uses", () => {
    const b = bin({ lastFillLevelPercent: 150 }); // no sensor_readings doc, no latestReading — just the bin's own stale/bad stored field
    const r = getBinPriority(b, null, []);
    expect(r.sensorHealth.status).toBe("fault");
    expect(r.sensorHealth.connectivity).toBe("fault");
  });

  it("active thermal alert boosts score and adds a reason", () => {
    const b = bin({ lastFillLevelPercent: 30, lastTemperatureCelsius: 25 });
    const noAlert = getBinPriority(b, null, [], { thermalAlert: false });
    const withAlert = getBinPriority(b, null, [], { thermalAlert: true });
    expect(withAlert.score).toBeGreaterThan(noAlert.score);
    expect(withAlert.reasons).toContain("تنبيه حراري نشط في الحي");
  });
});
