import { describe, expect, it } from "vitest";
import { areaPath, describeSeries, findGaps, gapMsFor, seriesPoints } from "./chart";
import type { SeriesDto } from "./machine-types";

/** 1 min range: 60 x 1 s buckets ending at 60_000. `filled` lists the 1-based bucket numbers. */
function oneMin(filled: number[], peak: SeriesDto["peak"] = null): SeriesDto {
  return {
    metric: "cpu",
    range: "1m",
    bucketMs: 1000,
    endMs: 60_000,
    buckets: Array.from({ length: 60 }, (_, i) =>
      filled.includes(i + 1) ? { tMs: (i + 1) * 1000, min: 10, avg: 20, max: 30 } : null,
    ),
    peak,
  };
}

describe("gapMsFor", () => {
  it("is three buckets, at least five seconds", () => {
    expect(gapMsFor(1000)).toBe(5000);
    expect(gapMsFor(5000)).toBe(15_000);
    expect(gapMsFor(20_000)).toBe(60_000);
  });
});

describe("findGaps", () => {
  it("finds no gap when only single slots are missing", () => {
    const filled = Array.from({ length: 60 }, (_, i) => i + 1).filter((n) => n !== 30);
    expect(findGaps(oneMin(filled))).toEqual([]);
  });

  it("reports a hole in the middle", () => {
    const filled = [
      ...Array.from({ length: 10 }, (_, i) => i + 1),
      ...Array.from({ length: 11 }, (_, i) => i + 50),
    ];
    expect(findGaps(oneMin(filled))).toEqual([{ fromMs: 10_000, toMs: 50_000 }]);
  });

  it("reports the unsampled start and end of the window", () => {
    expect(findGaps(oneMin([30, 31]))).toEqual([
      { fromMs: 0, toMs: 30_000 },
      { fromMs: 31_000, toMs: 60_000 },
    ]);
  });

  it("a series with nothing sampled is one gap over the whole window", () => {
    expect(findGaps(oneMin([]))).toEqual([{ fromMs: 0, toMs: 60_000 }]);
  });
});

describe("seriesPoints", () => {
  it("keeps only sampled buckets, as their average", () => {
    expect(seriesPoints(oneMin([3, 4]))).toEqual([
      { atMs: 3000, value: 20 },
      { atMs: 4000, value: 20 },
    ]);
  });
});

describe("areaPath", () => {
  it("closes the line down to the baseline", () => {
    expect(areaPath("0,10 5,20", 30)).toBe("M0,10 L5,20 L5,30 L0,30 Z");
  });
  it("needs at least two points", () => {
    expect(areaPath("0,10", 30)).toBeNull();
  });
});

describe("describeSeries", () => {
  it("says the range, the peak with its culprit and the unsampled spans", () => {
    const peak = {
      tMs: 31_000,
      value: 97,
      top: { name: "Cursor", cpuPct: 90 },
    };
    const text = describeSeries(oneMin([30, 31], peak), "%");
    expect(text).toContain("20 % to 20 %");
    expect(text).toMatch(/peak 97 % at \d\d:\d\d · Cursor/);
    expect(text).toContain("2 spans not sampled");
  });
  it("says so when there is nothing", () => {
    expect(describeSeries(oneMin([]), "%")).toBe("No samples in this range.");
  });
});
