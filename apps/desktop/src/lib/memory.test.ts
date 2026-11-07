import { describe, expect, it } from "vitest";
import {
  DEFAULT_THRESHOLDS,
  PRESSURE_COPY,
  PROTECTED_COPY,
  SMALL_PROCESS_BYTES,
  groupProcesses,
  SIGNAL_COPY,
  VERDICT_COPY,
  VERDICT_LABEL,
  formatBytes,
  growthLabel,
  memoryCurrent,
  memoryHistory,
  memoryThresholds,
  processKey,
  setMemoryThresholds,
  summarizeBuckets,
  swapPercent,
  toKillTarget,
  verdictColor,
} from "./memory";
import type { MemoryProcess } from "./types";

const GIB = 1024 ** 3;

describe("memory helpers", () => {
  it("has plain copy for every verdict, signal and pressure level", () => {
    expect(VERDICT_COPY.ok).toBe("Memory is fine");
    expect(VERDICT_LABEL).toEqual({ ok: "OK", watch: "WATCH", stop: "STOP" });
    expect(Object.keys(SIGNAL_COPY)).toEqual(["pressure", "swap", "bigProcess", "growing"]);
    expect(Object.keys(PRESSURE_COPY)).toEqual(["normal", "warning", "critical"]);
  });

  it("colours the verdict on the band palette: ok mint, watch yellow, stop red", () => {
    expect(verdictColor("ok")).toBe("var(--pw-band-normal)");
    expect(verdictColor("watch")).toBe("var(--pw-band-warm)");
    expect(verdictColor("stop")).toBe("var(--pw-band-throttling)");
  });

  it("formats bytes in GB from 1 GiB up and MB below, and zero as 0 MB", () => {
    expect(formatBytes(0)).toBe("0 MB");
    expect(formatBytes(512 * 1024 ** 2)).toBe("512 MB");
    expect(formatBytes(1.5 * GIB)).toBe("1.5 GB");
    expect(formatBytes(16 * GIB)).toBe("16.0 GB");
  });

  it("words the growth since the first retained sample, or nothing without one", () => {
    const clock = () => "14:02";
    expect(
      growthLabel(
        { footprintBytes: 9 * GIB, firstFootprintBytes: 4 * GIB, firstSampleAt: 1 },
        clock,
      ),
    ).toBe("growing ×2.3 since 14:02");
    expect(
      growthLabel(
        { footprintBytes: 9 * GIB, firstFootprintBytes: null, firstSampleAt: null },
        clock,
      ),
    ).toBeNull();
  });

  it("rounds swap to a whole percent and treats no swap as 0", () => {
    expect(swapPercent({ swapUsedBytes: 9 * GIB, swapTotalBytes: 12 * GIB })).toBe(75);
    expect(swapPercent({ swapUsedBytes: 0, swapTotalBytes: 0 })).toBe(0);
  });

  it("keys a process by pid and start time, so a reused pid is another row", () => {
    expect(processKey({ pid: 1, startedAt: 10 })).not.toBe(processKey({ pid: 1, startedAt: 11 }));
  });

  it("builds a two-step kill target that carries the row's first port", () => {
    const p = {
      pid: 4242,
      startedAt: 7,
      name: "node",
      ports: [5173],
      killable: true,
    } as MemoryProcess;
    expect(toKillTarget(p)).toMatchObject({ pid: 4242, startedAt: 7, port: 5173, category: "app" });
    expect(toKillTarget({ ...p, ports: [] }).port).toBe(0);
  });

  it("summarizes the day's peaks, or nothing without buckets", () => {
    const b = (used: number, swap: number) => ({
      startS: 0,
      usedAvgBytes: used,
      usedMaxBytes: used,
      swapAvgBytes: swap,
      swapMaxBytes: swap,
      worstPressure: "normal" as const,
      samples: 1,
    });
    expect(summarizeBuckets([])).toBeNull();
    expect(summarizeBuckets([b(1, 5), b(3, 2)])).toEqual({ usedMax: 3, swapMax: 5 });
  });

  it("explains every protected reason in one line", () => {
    expect(PROTECTED_COPY).toEqual({
      system: "macOS system process. Stopping it can log you out or crash macOS.",
      otherUser: "Runs as another user.",
      self: "This is chapay.",
      lowPid: "Core system process.",
    });
  });

  it("groups rows into yours and protected and folds those under the floor", async () => {
    const reading = (await memoryCurrent())!;
    const all = groupProcesses(reading.processes, true);
    expect(all.smallCount).toBeGreaterThan(0);
    expect(all.yours.length + all.protectedRows.length).toBe(reading.processes.length);
    expect(all.yours.every((p) => p.killable)).toBe(true);
    expect(all.protectedRows.every((p) => !p.killable)).toBe(true);

    const folded = groupProcesses(reading.processes, false);
    expect(
      [...folded.yours, ...folded.protectedRows].every(
        (p) => p.footprintBytes >= SMALL_PROCESS_BYTES,
      ),
    ).toBe(true);
    expect(folded.yours.length + folded.protectedRows.length + folded.smallCount).toBe(
      reading.processes.length,
    );
    // The header counts every protected row, folded or not.
    expect(folded.protectedCount).toBe(all.protectedRows.length);
    expect(reading.unattributedBytes).toBeGreaterThan(0);
  });

  it("mocks an Apple process owned by the user as protected, without a command", async () => {
    const reading = (await memoryCurrent())!;
    const apple = reading.processes.find((p) => p.name.startsWith("com.apple.Virtualization"));
    expect(apple?.user).toBe("me");
    expect(apple?.protectedReason).toBe("system");
    expect(apple?.command).toBeNull();
  });

  it("returns mocks outside Tauri: a root daemon with a command and a growing process", async () => {
    const reading = await memoryCurrent();
    expect(reading).not.toBeNull();
    const daemon = reading!.top.find((p) => !p.killable);
    expect(daemon?.command?.text).toMatch(/^sudo launchctl kickstart -k system\//);
    expect(reading!.top.some((p) => p.killable && p.flags.includes("growing"))).toBe(true);
    const now = Math.floor(Date.now() / 1000);
    const history = await memoryHistory(now - 7200, now, 7);
    expect(history.available).toBe(true);
    expect(history.days).toHaveLength(7);
  });

  it("keeps edited thresholds in memory outside Tauri and starts at the defaults", async () => {
    expect(await memoryThresholds()).toEqual(DEFAULT_THRESHOLDS);
    await setMemoryThresholds({ ...DEFAULT_THRESHOLDS, swapWatchPct: 70 });
    expect((await memoryThresholds()).swapWatchPct).toBe(70);
    await setMemoryThresholds(DEFAULT_THRESHOLDS);
  });
});
