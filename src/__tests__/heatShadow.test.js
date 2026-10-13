import { describe, it, expect } from "vitest";
import { heatShadow, updateLearnedFillRates } from "../../api/_lib/dispatchRunner.mjs";

const H = 3600000;
const AUG = Date.UTC(2025, 7, 10, 12);
const iso = (t) => new Date(t).toISOString();

describe("heatShadow — what the heat rule would do this cycle", () => {
  it("counts summer bins that reach the hygiene limit before the next run; skips dry and unknown", () => {
    const state = {
      bins: [
        { id: "A", wasteType: "مختلط", lastCollectionAt: iso(AUG - 40 * H) },  // would trigger
        { id: "B", wasteType: "مختلط", lastCollectionAt: iso(AUG - 2 * H) },   // fresh
        { id: "C", wasteType: "ورق", lastCollectionAt: iso(AUG - 72 * H) },    // dry: not applicable
        { id: "D", wasteType: "مختلط" },                                       // no emptying time
      ],
      readingsByBin: {},
    };
    const r = heatShadow(state, "observe", AUG);
    expect(r).toMatchObject({ mode: "observe", wouldTrigger: 1, unavailable: 1, binIds: ["A"] });
  });
});

describe("updateLearnedFillRates", () => {
  const fakeDb = () => {
    const writes = [];
    return { writes, batch: () => ({ update: (ref, data) => writes.push({ id: ref.id, data }), commit: async () => {} }), collection: () => ({ doc: (id) => ({ id }) }) };
  };
  const rising = (perHour) => Array.from({ length: 8 }, (_, i) => ({ timestamp: iso(AUG - (8 - i) * H), fill_level_percent: 10 + i * perHour }));

  it("learns the daily rate from reliable readings and smooths it", async () => {
    const db = fakeDb();
    const n = await updateLearnedFillRates(db, { bins: [{ id: "A" }, { id: "B", learnedFillRatePerDay: 100 }], readingsByBin: { A: rising(2), B: rising(2) } });
    expect(n).toBe(2);
    expect(db.writes.find((w) => w.id === "A").data.learnedFillRatePerDay).toBeCloseTo(48, 0);
    expect(db.writes.find((w) => w.id === "B").data.learnedFillRatePerDay).toBeCloseTo(0.7 * 100 + 0.3 * 48, 0);
  });

  it("skips bins without a reliable rising rate", async () => {
    const db = fakeDb();
    const n = await updateLearnedFillRates(db, { bins: [{ id: "A" }], readingsByBin: { A: rising(0) } });
    expect(n).toBe(0);
  });
});
