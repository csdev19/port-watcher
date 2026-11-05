import { describe, expect, it } from "vitest";
import {
  BAND_COPY,
  STATE_COPY,
  baselineDelta,
  formatDay,
  formatTemp,
  summarize,
  thermalCurrent,
  thermalHistory,
  todayRange,
} from "./thermal";
import type { ThermalBucket } from "./types";

describe("thermal helpers", () => {
  it("has plain copy for every band and state", () => {
    expect(BAND_COPY.cool).toBe("Idle or light work");
    expect(BAND_COPY.normal).toBe("Everyday work");
    expect(BAND_COPY.warm).toBe("Sustained load: builds, video, many tabs");
    expect(BAND_COPY.hot).toBe("Heavy load, close to throttling");
    expect(BAND_COPY.throttling).toBe("macOS slows the chip to cool it");
    expect(STATE_COPY.serious).toBe("macOS reports high thermal pressure");
    expect(Object.keys(STATE_COPY)).toEqual(["nominal", "fair", "serious", "critical"]);
  });

  it("rounds temperatures to whole degrees", () => {
    expect(formatTemp(58.4)).toBe("58°");
    expect(formatTemp(58.5)).toBe("59°");
  });

  it("describes the gap to the 7-day baseline, or nothing without one", () => {
    expect(baselineDelta({ avgC: 58.4, baselineC: 54.2 })).toBe("+4° vs your 7-day average");
    expect(baselineDelta({ avgC: 50, baselineC: 53.6 })).toBe("-4° vs your 7-day average");
    expect(baselineDelta({ avgC: 54.1, baselineC: 53.9 })).toBe("At your 7-day average");
    expect(baselineDelta({ avgC: 58, baselineC: null })).toBeNull();
  });

  it("computes today's range from local midnight to now", () => {
    const now = new Date(2026, 10, 4, 15, 30, 10);
    const { fromS, toS } = todayRange(now);
    expect(fromS).toBe(new Date(2026, 10, 4, 0, 0, 0).getTime() / 1000);
    expect(toS).toBe(Math.floor(now.getTime() / 1000));
  });

  it("formats a local day without shifting it", () => {
    expect(formatDay("2026-11-04")).toMatch(/4/);
  });

  it("summarizes buckets weighted by samples", () => {
    const b = (avgC: number, samples: number, minC: number, maxAvgC: number): ThermalBucket => ({
      startS: 0,
      minC,
      avgC,
      maxAvgC,
      maxC: maxAvgC + 5,
      worstState: "nominal",
      samples,
    });
    expect(summarize([])).toBeNull();
    expect(summarize([b(50, 1, 45, 55), b(60, 3, 58, 66)])).toEqual({
      min: 45,
      avg: 57.5,
      max: 66,
    });
  });

  it("returns deterministic mocks outside Tauri", async () => {
    const reading = await thermalCurrent();
    expect(reading).toMatchObject({ band: "normal", state: "nominal" });
    const now = Math.floor(Date.now() / 1000);
    const history = await thermalHistory(now - 7200, now, 7);
    expect(history.available).toBe(true);
    expect(history.days).toHaveLength(7);
    expect(history.peaks[0].processes[0].ports).toContain(5173);
  });
});
