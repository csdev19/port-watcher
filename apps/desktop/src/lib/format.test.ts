import { describe, expect, it } from "vitest";
import { formatMemory, formatUptime, middleTruncate } from "./format";

const NOW = 1_800_000_000_000; // fixed ms clock for determinism

describe("formatUptime", () => {
  const started = (secsAgo: number) => NOW / 1000 - secsAgo;
  it("seconds under a minute", () => {
    expect(formatUptime(started(45), NOW)).toBe("45s");
  });
  it("minutes under an hour", () => {
    expect(formatUptime(started(12 * 60), NOW)).toBe("12m");
  });
  it("hours under a day", () => {
    expect(formatUptime(started(2 * 3600 + 40 * 60), NOW)).toBe("2h");
  });
  it("days from then on", () => {
    expect(formatUptime(started(3 * 86400), NOW)).toBe("3d");
  });
  it("unknown start (0) renders em dash", () => {
    expect(formatUptime(0, NOW)).toBe("—");
  });
});

describe("formatMemory", () => {
  it("MB below 1 GB", () => {
    expect(formatMemory(210 * 1024 * 1024)).toBe("210 MB");
  });
  it("GB with one decimal above 1 GB", () => {
    expect(formatMemory(1.5 * 1024 * 1024 * 1024)).toBe("1.5 GB");
  });
  it("zero renders em dash", () => {
    expect(formatMemory(0)).toBe("—");
  });
});

describe("middleTruncate", () => {
  it("short strings pass through", () => {
    expect(middleTruncate("~/dev/api", 30)).toBe("~/dev/api");
  });
  it("long paths keep both ends (the end identifies the project)", () => {
    const out = middleTruncate("~/dev/laqi/panel-long-name/apps/dashboard", 24);
    expect(out.length).toBeLessThanOrEqual(24);
    expect(out).toContain("…");
    expect(out.startsWith("~/dev")).toBe(true);
    expect(out.endsWith("dashboard")).toBe(true);
  });
});
