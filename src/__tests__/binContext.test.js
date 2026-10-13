import { describe, it, expect } from "vitest";
import { thermalFeedFromBins, thermalRiskLevel, makeThermalAlertFor, makeBinContext } from "../binContext";

const now = Date.now();
const minutesAgo = (m) => new Date(now - m * 60000).toISOString();
const NB = [{ id: "N1", name: "حي الريان" }, { id: "N2", name: "حي الصفراء" }];

function bin(overrides = {}) {
  return { id: "B1", neighborhoodId: "N1", deviceId: "DEV-1", lastFillLevelPercent: 40, lastTemperatureCelsius: 30, lastReadingAt: minutesAgo(2), ...overrides };
}

describe("thermalRiskLevel", () => {
  it("maps temperature tiers from THRESHOLDS", () => {
    expect(thermalRiskLevel(30)).toBe("آمن");
    expect(thermalRiskLevel(55)).toBe("تحذير");
    expect(thermalRiskLevel(62)).toBe("خطر متوسط");
    expect(thermalRiskLevel(80)).toBe("خطر عالي");
    expect(thermalRiskLevel(null)).toBe("غير معروف");
  });
});

describe("thermalFeedFromBins — alerts come from the bins' own probes", () => {
  it("takes the hottest online bin of each neighborhood", () => {
    const feed = thermalFeedFromBins([bin({ id: "B1", lastTemperatureCelsius: 35 }), bin({ id: "B2", lastTemperatureCelsius: 63 })], NB, now);
    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({ district: "حي الريان", maxTemp: 63, riskLevel: "خطر متوسط", binsWithTemp: 2, hotBinIds: ["B2"] });
  });

  it("ignores offline, faulty and sensorless bins", () => {
    const feed = thermalFeedFromBins([
      bin({ id: "OFF", lastTemperatureCelsius: 90, lastReadingAt: minutesAgo(120) }),
      bin({ id: "FAULT", lastTemperatureCelsius: 150 }),
      bin({ id: "NOSENSOR", deviceId: null, lastTemperatureCelsius: 90 }),
    ], NB, now);
    expect(feed).toHaveLength(0);
  });

  it("feeds makeThermalAlertFor / makeBinContext unchanged", () => {
    const feed = thermalFeedFromBins([bin({ lastTemperatureCelsius: 65 }), bin({ id: "B3", neighborhoodId: "N2", lastTemperatureCelsius: 31 })], NB, now);
    const alertFor = makeThermalAlertFor(feed);
    expect(alertFor("حي الريان")).toBe(true);
    expect(alertFor("حي الصفراء")).toBe(false);
    const ctx = makeBinContext(feed, [], NB);
    expect(ctx.forBin(bin()).thermalAlert).toBe(true);
  });

  it("a merely hot summer bin (warning tier) does not raise a thermal alert", () => {
    const feed = thermalFeedFromBins([bin({ lastTemperatureCelsius: 54 })], NB, now);
    expect(feed[0].riskLevel).toBe("تحذير");
    expect(makeThermalAlertFor(feed)("حي الريان")).toBe(false);
  });
});
