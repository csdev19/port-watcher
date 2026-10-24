import { describe, expect, it } from "vitest";
import { bandText, gaugeAriaLabel, levelWord } from "./gauges";
import type { GaugeDto } from "./machine-types";

function gauge(over: Partial<GaugeDto>): GaugeDto {
  return {
    id: "cpu",
    level: "ok",
    value: "34%",
    extra: null,
    driver: "Cursor Helper 22% · 12 cores",
    warn: 80,
    stop: null,
    min: 0,
    max: 100,
    unit: "%",
    available: true,
    unavailableReason: null,
    ...over,
  };
}

describe("bandText", () => {
  it("reads a warn-only band when stop is null", () => {
    expect(bandText(gauge({}))).toBe("ok < 80 · warn ≥ 80");
  });
  it("reads all three bands when stop exists", () => {
    expect(bandText(gauge({ warn: 50, stop: 80 }))).toBe("ok < 50 · warn 50–80 · stop ≥ 80");
  });
  it("adds the unit to temperatures", () => {
    expect(bandText(gauge({ id: "heat", unit: "°C", warn: 80, stop: 95 }))).toBe(
      "ok < 80 · warn 80–95 · stop ≥ 95 °C",
    );
  });
  it("names the pressure levels for pressure-based gauges", () => {
    expect(bandText(gauge({ id: "heat", unit: "level", warn: null, stop: null }))).toBe(
      "Nominal · Fair · Serious · Critical",
    );
    expect(bandText(gauge({ id: "memory", warn: null }))).toBe("Normal · Warning · Critical");
  });
});

describe("gaugeAriaLabel", () => {
  it("carries value, level word, driver and band", () => {
    expect(gaugeAriaLabel(gauge({}))).toBe(
      "CPU, 34%, normal. Cursor Helper 22% · 12 cores. ok < 80 · warn ≥ 80",
    );
  });
  it("includes the hotspot next to the pressure word", () => {
    const label = gaugeAriaLabel(
      gauge({ id: "heat", value: "Nominal", extra: "115 °C", level: "stop", unit: "°C", stop: 95 }),
    );
    expect(label).toContain("Nominal, hotspot 115 °C, stop");
  });
  it("says not available with the reason", () => {
    expect(
      gaugeAriaLabel(gauge({ id: "gpu", available: false, unavailableReason: "no GPU" })),
    ).toBe("GPU, not available. no GPU");
  });
  it("never relies on colour: every level has a word", () => {
    expect(levelWord("ok")).toBe("normal");
    expect(levelWord("watch")).toBe("watch");
    expect(levelWord("stop")).toBe("stop");
  });
});
