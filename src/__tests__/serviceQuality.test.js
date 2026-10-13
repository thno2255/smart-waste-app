import { describe, it, expect } from "vitest";
import { fillAtCollection, overflowHours, computeServiceQuality } from "../serviceQuality";

const H = 3600000;
const AUG = Date.UTC(2025, 7, 10, 12);
const JAN = Date.UTC(2025, 0, 10, 12);
const iso = (t) => new Date(t).toISOString();

describe("fillAtCollection", () => {
  it("summarises server-confirmed lifts in the window only", () => {
    const ev = [10, 40, 80, 90].map((f, i) => ({ fillBefore: f, confirmedAt: iso(AUG - (i + 1) * H) }));
    ev.push({ fillBefore: 5, confirmedAt: iso(AUG - 30 * 24 * H) }); // outside the 7-day window
    expect(fillAtCollection(ev, AUG)).toEqual({ n: 4, median: 60, mean: 55, lowSharePct: 25 });
  });
  it("returns nulls, not zeros, without data", () => {
    expect(fillAtCollection([], AUG)).toEqual({ n: 0, median: null, mean: null, lowSharePct: null });
  });
});

describe("overflowHours", () => {
  it("counts bin-hours at ≥ 98 % between close readings", () => {
    const rs = [0, 1, 2, 3].map((i) => ({ bin_id: "A", timestamp: iso(AUG + i * H), fill_level_percent: i >= 1 ? 99 : 90 }));
    const r = overflowHours(rs, 1, 24);
    expect(r.binHours).toBe(2);           // 1→2 and 2→3
    expect(r.per100PerDay).toBe(200);
  });
  it("ignores long gaps", () => {
    const rs = [{ bin_id: "A", timestamp: iso(AUG), fill_level_percent: 100 }, { bin_id: "A", timestamp: iso(AUG + 5 * H), fill_level_percent: 100 }];
    expect(overflowHours(rs, 1).binHours).toBe(0);
  });
});

describe("computeServiceQuality", () => {
  it("counts hygiene and untrusted sensors from the priority engine", () => {
    const bins = [
      { id: "A", deviceId: "D", wasteType: "مختلط", lastFillLevelPercent: 30, lastReadingAt: iso(AUG - 60000), lastCollectionAt: iso(AUG - 40 * H) },
      { id: "B", deviceId: "D2", lastFillLevelPercent: 10, lastReadingAt: iso(AUG - 6 * H), lastCollectionAt: iso(AUG - 50 * H), learnedFillRatePerDay: 60 },
    ];
    const q = computeServiceQuality({ bins, now: AUG });
    expect(q.hygiene.wouldTrigger).toBeGreaterThanOrEqual(1);
    expect(q.trust).toEqual({ untrusted: 1, estimatedCritical: 1, estimatedOverflow: 1 });
  });
  it("seasonal guidance: a sun bin can wait far longer in January than in August", () => {
    const aug = computeServiceQuality({ now: AUG }).season.daysToLimit;
    const jan = computeServiceQuality({ now: JAN }).season.daysToLimit;
    expect(aug).toBeLessThan(2.2);
    expect(jan).toBeGreaterThan(5);
  });
});
