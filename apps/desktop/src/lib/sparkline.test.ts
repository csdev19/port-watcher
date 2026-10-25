import { describe, expect, it } from "vitest";
import { lineY, seriesFor, summarize, toPolylines } from "./sparkline";
import type { GaugeDto, HistoryPoint } from "./machine-types";

const base = { windowMs: 60_000, min: 0, max: 100, w: 118, h: 30, gapMs: 2500, pad: 0 };
const NOW = 1_000_000;

function pts(...rows: Array<[number, number | null]>) {
  return rows.map(([secAgo, value]) => ({ atMs: NOW - secAgo * 1000, value }));
}

describe("toPolylines", () => {
  it("draws time on the x axis: newest at the right edge, oldest at the left", () => {
    // 60 s apart is a gap, so each point is its own segment.
    const lines = toPolylines(pts([60, 0], [0, 100]), { ...base, nowMs: NOW });
    expect(lines).toEqual(["0,30", "118,0"]);
  });

  it("splits the line at a gap longer than gapMs", () => {
    const lines = toPolylines(pts([20, 10], [19, 10], [18, 10], [12, 10], [11, 10]), {
      ...base,
      nowMs: NOW,
    });
    expect(lines).toHaveLength(2);
    expect(lines[0]!.split(" ")).toHaveLength(3);
    expect(lines[1]!.split(" ")).toHaveLength(2);
  });

  it("keeps points exactly gapMs apart in one line and splits just past it", () => {
    const one = toPolylines(pts([5, 1], [2.5, 1]), { ...base, nowMs: NOW });
    expect(one).toHaveLength(1);
    const two = toPolylines(pts([5, 1], [2.4, 1]), { ...base, nowMs: NOW });
    expect(two).toHaveLength(2);
  });

  it("drops points older than the window and points from the future", () => {
    const lines = toPolylines(pts([61, 50], [60, 50], [1, 50], [-5, 50]), { ...base, nowMs: NOW });
    expect(lines).toHaveLength(2);
    expect(lines.join(" ").split(" ")).toHaveLength(2);
  });

  it("a null value splits the line and is never drawn", () => {
    const lines = toPolylines(pts([4, 10], [3, null], [2, 10]), { ...base, nowMs: NOW });
    expect(lines).toHaveLength(2);
  });

  it("returns nothing for no data", () => {
    expect(toPolylines([], { ...base, nowMs: NOW })).toEqual([]);
  });
});

describe("lineY", () => {
  const o = { min: 30, max: 120, h: 30, pad: 0 };
  it("maps the min to the bottom and the max to the top", () => {
    expect(lineY(30, o)).toBe(30);
    expect(lineY(120, o)).toBe(0);
  });
  it("places the warn and stop lines at their own heights", () => {
    expect(lineY(80, o)).toBeCloseTo(30 - (50 / 90) * 30, 1);
    expect(lineY(95, o)).toBeLessThan(lineY(80, o));
  });
  it("clamps values outside the range", () => {
    expect(lineY(500, o)).toBe(0);
    expect(lineY(-5, o)).toBe(30);
  });
});

describe("summarize", () => {
  it("states the range and the trend", () => {
    expect(summarize([22, 30, 41], "%")).toBe("22 to 41 percent, rising");
    expect(summarize([41, 30, 22], "%")).toBe("22 to 41 percent, falling");
    expect(summarize([30, 31, 29, 30], "%")).toBe("29 to 31 percent, steady");
  });
  it("collapses an identical range", () => {
    expect(summarize([50, 50], "%")).toBe("50 percent, steady");
  });
  it("uses degrees for temperatures and words for pressure steps", () => {
    expect(summarize([60, 70], "°C")).toBe("60 to 70 degrees, rising");
    expect(summarize([0, 0, 1], "level")).toBe("nominal to fair, rising");
  });
  it("ignores nulls and stays empty without enough data", () => {
    expect(summarize([null, 5], "%")).toBe("");
    expect(summarize([], "%")).toBe("");
  });
});

describe("seriesFor", () => {
  const history: HistoryPoint[] = [
    { atMs: 1, cpu: 10, gpu: 5, heat: 70, heatLevel: 1, memUsedPct: 75 },
  ];
  const gauge = (id: GaugeDto["id"], unit: GaugeDto["unit"]) => ({ id, unit }) as GaugeDto;
  it("picks the column each gauge draws", () => {
    expect(seriesFor(gauge("cpu", "%"), history)[0]!.value).toBe(10);
    expect(seriesFor(gauge("gpu", "%"), history)[0]!.value).toBe(5);
    expect(seriesFor(gauge("memory", "%"), history)[0]!.value).toBe(75);
    expect(seriesFor(gauge("heat", "°C"), history)[0]!.value).toBe(70);
    expect(seriesFor(gauge("heat", "level"), history)[0]!.value).toBe(1);
  });
});
