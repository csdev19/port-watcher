import { invoke } from "@tauri-apps/api/core";
import { inTauri } from "./ports";
import type {
  KillResult,
  MemoryBucket,
  MemoryDay,
  MemoryHistory,
  MemoryPressure,
  MemoryProcess,
  MemoryReading,
  MemorySignal,
  MemoryThresholds,
  MemoryVerdict,
  PortEntry,
  ProtectedReason,
} from "./types";

const GIB = 1024 ** 3;

/** Mirror of the Rust defaults (src-tauri/src/memory); also what Reset restores. */
export const DEFAULT_THRESHOLDS: MemoryThresholds = {
  swapWatchPct: 80,
  swapStopPct: 95,
  bigProcessPct: 25,
  growthFactor: 2,
  growthMinBytes: 2 * GIB,
};

/** A fresh system read; `null` when the system figures cannot be read. */
export async function memoryCurrent(): Promise<MemoryReading | null> {
  if (!inTauri) return mockReading(Math.floor(Date.now() / 1000));
  return invoke<MemoryReading | null>("memory_current");
}

/** Buckets in [fromS, toS] plus the last `days` daily summaries. */
export async function memoryHistory(
  fromS: number,
  toS: number,
  days: number,
): Promise<MemoryHistory> {
  if (!inTauri) return mockHistory(fromS, toS, days);
  return invoke<MemoryHistory>("memory_history", { fromS, toS, days });
}

let mockThresholds: MemoryThresholds = { ...DEFAULT_THRESHOLDS };

export async function memoryThresholds(): Promise<MemoryThresholds> {
  if (!inTauri) return mockThresholds;
  return invoke<MemoryThresholds>("memory_thresholds");
}

export async function setMemoryThresholds(thresholds: MemoryThresholds): Promise<void> {
  if (!inTauri) {
    mockThresholds = { ...thresholds };
    return;
  }
  await invoke("set_memory_thresholds", { thresholds });
}

/** Kills a process that holds no listening port. Passes startedAt so the Rust
 * side can refuse a recycled PID. Rust re-runs the Ports kill policy. */
export async function killProcess(pid: number, startedAt: number): Promise<KillResult> {
  if (!inTauri) return "terminated";
  return invoke<KillResult>("kill_process", { pid, startedAt });
}

/** What the verdict means, in the words the header line uses. */
export const VERDICT_COPY: Record<MemoryVerdict, string> = {
  ok: "Memory is fine",
  watch: "Worth watching",
  stop: "Memory is the problem",
};

/** Short pill text for the verdict. */
export const VERDICT_LABEL: Record<MemoryVerdict, string> = {
  ok: "OK",
  watch: "WATCH",
  stop: "STOP",
};

/** Why a verdict is what it is, one phrase per signal. */
export const SIGNAL_COPY: Record<MemorySignal, string> = {
  pressure: "macOS reports memory pressure",
  swap: "Swap is nearly full",
  bigProcess: "One process holds a large share of RAM",
  growing: "A process keeps growing",
};

/** What macOS itself reports through its memory pressure level. */
export const PRESSURE_COPY: Record<MemoryPressure, string> = {
  normal: "Normal",
  warning: "Warning",
  critical: "Critical",
};

/** Why a row has no Kill, on one line. */
export const PROTECTED_COPY: Record<ProtectedReason, string> = {
  system: "macOS system process. Stopping it can log you out or crash macOS.",
  otherUser: "Runs as another user.",
  self: "This is chapay.",
  lowPid: "Core system process.",
};

/** Rows under this footprint are folded behind "Show all". */
export const SMALL_PROCESS_BYTES = 50 * 1024 ** 2;

export interface ProcessGroups {
  /** Killable rows to show. */
  yours: MemoryProcess[];
  /** Protected rows to show. */
  protectedRows: MemoryProcess[];
  /** Every protected row, small ones included, for the group header. */
  protectedCount: number;
  protectedBytes: number;
  /** Rows folded under the floor (both groups) and what they add up to. */
  smallCount: number;
  smallBytes: number;
}

/** Splits the full list into Yours and Protected. Unless `showAll`, rows under
 * the 50 MB floor are left out of both and counted in `small*`. */
export function groupProcesses(processes: MemoryProcess[], showAll: boolean): ProcessGroups {
  const groups: ProcessGroups = {
    yours: [],
    protectedRows: [],
    protectedCount: 0,
    protectedBytes: 0,
    smallCount: 0,
    smallBytes: 0,
  };
  for (const p of processes) {
    const protectedRow = !p.killable;
    if (protectedRow) {
      groups.protectedCount += 1;
      groups.protectedBytes += p.footprintBytes;
    }
    const small = p.footprintBytes < SMALL_PROCESS_BYTES;
    if (small) {
      groups.smallCount += 1;
      groups.smallBytes += p.footprintBytes;
    }
    if (small && !showAll) continue;
    (protectedRow ? groups.protectedRows : groups.yours).push(p);
  }
  return groups;
}

/** Verdict colour, on the palette `bandColor` uses: ok mint, watch yellow, stop red. */
export function verdictColor(verdict: MemoryVerdict): string {
  switch (verdict) {
    case "ok":
      return "var(--pw-band-normal)";
    case "watch":
      return "var(--pw-band-warm)";
    case "stop":
      return "var(--pw-band-throttling)";
  }
}

/** "1.5 GB" from 1 GiB up, "512 MB" below; zero is "0 MB". */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 MB";
  const gb = bytes / GIB;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}

/** The growth pill's text: "growing ×2.3 since 14:02", or null without a baseline. */
export function growthLabel(
  p: Pick<MemoryProcess, "footprintBytes" | "firstFootprintBytes" | "firstSampleAt">,
  formatClock: (epochS: number) => string,
): string | null {
  if (p.firstFootprintBytes === null || p.firstFootprintBytes <= 0 || p.firstSampleAt === null) {
    return null;
  }
  const factor = p.footprintBytes / p.firstFootprintBytes;
  return `growing ×${factor.toFixed(1)} since ${formatClock(p.firstSampleAt)}`;
}

/** Swap used as a whole percent of swap total; 0 when there is no swap. */
export function swapPercent(reading: Pick<MemoryReading, "swapUsedBytes" | "swapTotalBytes">) {
  if (reading.swapTotalBytes <= 0) return 0;
  return Math.round((reading.swapUsedBytes / reading.swapTotalBytes) * 100);
}

/** A stable key for one process incarnation. */
export function processKey(p: Pick<MemoryProcess, "pid" | "startedAt">): string {
  return `memory:${p.pid}:${p.startedAt}`;
}

/** The shape `useKillConfirm` and `killPort` take, for a Memory row. The
 * category is "app" so the confirmation is always two-step: a memory hog is
 * rarely a throwaway dev server. Rust still decides with `is_killable`. */
export function toKillTarget(p: MemoryProcess): PortEntry {
  return {
    port: p.ports[0] ?? 0,
    pid: p.pid,
    processName: p.name,
    command: p.executablePath ?? p.name,
    cwd: null,
    project: null,
    label: p.name,
    user: p.user,
    startedAt: p.startedAt,
    memoryBytes: p.footprintBytes,
    killable: p.killable,
    category: "app",
    executablePath: p.executablePath,
    appBundlePath: null,
  };
}

/** Highest used and swap memory across buckets, for the today line. */
export function summarizeBuckets(
  buckets: MemoryBucket[],
): { usedMax: number; swapMax: number } | null {
  if (buckets.length === 0) return null;
  return {
    usedMax: Math.max(...buckets.map((b) => b.usedMaxBytes)),
    swapMax: Math.max(...buckets.map((b) => b.swapMaxBytes)),
  };
}

// --- Browser dev loop mocks (deterministic apart from the clock) ---

function mockReading(at: number): MemoryReading {
  const growingSince = at - 6 * 3600;
  const row = (
    pid: number,
    name: string,
    footprintBytes: number,
    extra: Partial<MemoryProcess> = {},
  ): MemoryProcess => ({
    pid,
    startedAt: at - 3 * 3600,
    name,
    executablePath: null,
    user: "me",
    footprintBytes,
    firstFootprintBytes: null,
    firstSampleAt: null,
    flags: [],
    killable: true,
    protectedReason: null,
    ports: [],
    command: null,
    ...extra,
  });
  const apple = (pid: number, name: string, footprintBytes: number, path: string) =>
    row(pid, name, footprintBytes, {
      executablePath: path,
      killable: false,
      protectedReason: "system",
    });
  const processes: MemoryProcess[] = [
    row(412, "zdpd", 8.4 * GIB, {
      startedAt: at - 8 * 86400,
      executablePath: "/Library/Application Support/Zscaler/zdpd",
      user: "root",
      firstFootprintBytes: 3.7 * GIB,
      firstSampleAt: growingSince,
      flags: ["bigProcess", "growing"],
      killable: false,
      protectedReason: "otherUser",
      command: {
        text: "sudo launchctl kickstart -k system/com.zscaler.zdpd",
        kind: "kickstart",
        note: "Runs as root; chapay cannot stop it.",
        securityVendor: "Zscaler",
      },
    }),
    row(4242, "node", 3.1 * GIB, {
      executablePath: "/opt/homebrew/bin/node",
      firstFootprintBytes: 1.2 * GIB,
      firstSampleAt: at - 2 * 3600,
      flags: ["growing"],
      ports: [5173],
    }),
    apple(
      2210,
      "com.apple.Virtualization.VirtualMachine",
      2.2 * GIB,
      "/System/Library/Frameworks/Virtualization.framework/Versions/A/XPCServices/com.apple.Virtualization.VirtualMachine.xpc/Contents/MacOS/com.apple.Virtualization.VirtualMachine",
    ),
    row(777, "Google Chrome Helper", 1.4 * GIB),
    apple(
      151,
      "WindowServer",
      0.9 * GIB,
      "/System/Library/PrivateFrameworks/SkyLight.framework/Resources/WindowServer",
    ),
    row(3120, "Slack Helper", 0.8 * GIB),
    row(3555, "Code Helper (Renderer)", 0.6 * GIB),
    row(630, "mds_stores", 0.4 * GIB, {
      user: "root",
      executablePath:
        "/System/Library/Frameworks/CoreServices.framework/Frameworks/Metadata.framework/Support/mds_stores",
      killable: false,
      protectedReason: "otherUser",
    }),
    apple(
      402,
      "Finder",
      0.2 * GIB,
      "/System/Library/CoreServices/Finder.app/Contents/MacOS/Finder",
    ),
    row(9001, "chapay", 0.12 * GIB, {
      executablePath: "/Applications/chapay.app/Contents/MacOS/chapay",
      killable: false,
      protectedReason: "self",
    }),
    row(1, "launchd", 0.03 * GIB, {
      user: "root",
      killable: false,
      protectedReason: "lowPid",
    }),
    apple(388, "cfprefsd", 0.04 * GIB, "/usr/sbin/cfprefsd"),
    row(5120, "zsh", 0.02 * GIB, { executablePath: "/bin/zsh" }),
    row(5121, "ssh-agent", 0.01 * GIB, { executablePath: "/usr/bin/ssh-agent" }),
    row(5122, "Spotlight Helper", 0.04 * GIB),
  ].sort((a, b) => b.footprintBytes - a.footprintBytes);
  const usedBytes = 21.4 * GIB;
  const attributed = processes.reduce((sum, p) => sum + p.footprintBytes, 0);
  return {
    at,
    totalBytes: 24 * GIB,
    usedBytes,
    compressedBytes: 5.2 * GIB,
    swapUsedBytes: 9.6 * GIB,
    swapTotalBytes: 12 * GIB,
    pressure: "warning",
    verdict: "watch",
    reasons: ["pressure", "swap", "bigProcess", "growing"],
    top: processes.slice(0, 8),
    processes,
    unattributedBytes: Math.max(0, usedBytes - attributed),
  };
}

function mockHistory(fromS: number, toS: number, days: number): MemoryHistory {
  const end = Math.floor(toS / 300) * 300;
  const buckets: MemoryBucket[] = [];
  for (let i = 0; i < 12; i++) {
    const startS = end - (11 - i) * 300;
    if (startS < fromS) continue;
    buckets.push({
      startS,
      usedAvgBytes: (18 + i * 0.25) * GIB,
      usedMaxBytes: (18.5 + i * 0.25) * GIB,
      swapAvgBytes: (6 + i * 0.3) * GIB,
      swapMaxBytes: (6.2 + i * 0.3) * GIB,
      worstPressure: i > 7 ? "warning" : "normal",
      samples: 5,
    });
  }
  const daySummaries: MemoryDay[] = [];
  for (let i = days; i >= 1; i--) {
    const d = new Date(toS * 1000);
    d.setDate(d.getDate() - i);
    const pad = (n: number) => String(n).padStart(2, "0");
    daySummaries.push({
      day: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      swapMaxBytes: (3 + (days - i)) * GIB,
      usedMaxBytes: (17 + (i % 3)) * GIB,
      warningMinutes: i === 2 ? 95 : 0,
    });
  }
  return { available: true, buckets, days: daySummaries };
}
