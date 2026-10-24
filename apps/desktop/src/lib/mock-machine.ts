import type { GaugeDto, HistoryPoint, MachineSnapshot, ProcessGroupDto } from "@/lib/machine-types";

/** Deterministic 0..1 wave so the browser dev loop (`vite:dev`) draws stable sparklines. */
function wave(i: number, period: number, phase = 0): number {
  return 0.5 + 0.5 * Math.sin((i + phase) / period);
}

export function mockHistory(nowMs: number, seconds = 60): HistoryPoint[] {
  const points: HistoryPoint[] = [];
  for (let i = seconds - 1; i >= 0; i--) {
    const k = seconds - 1 - i;
    points.push({
      atMs: nowMs - i * 1000,
      cpu: 22 + 40 * wave(k, 6),
      gpu: 8 + 20 * wave(k, 9, 2),
      heat: 58 + 28 * wave(k, 11, 1),
      heatLevel: k > 40 ? 1 : 0,
      memUsedPct: 74 + 3 * wave(k, 15),
    });
  }
  return points;
}

export function mockMachineSnapshot(nowMs: number = Date.now()): MachineSnapshot {
  const gauges: GaugeDto[] = [
    {
      id: "cpu",
      level: "ok",
      value: "41%",
      extra: null,
      driver: "Cursor Helper 22% · 12 cores",
      warn: 80,
      stop: null,
      min: 0,
      max: 100,
      unit: "%",
      available: true,
      unavailableReason: null,
    },
    {
      id: "gpu",
      level: "ok",
      value: "17%",
      extra: null,
      driver: "graphics load · 52 °C",
      warn: 90,
      stop: null,
      min: 0,
      max: 100,
      unit: "%",
      available: true,
      unavailableReason: null,
    },
    {
      id: "heat",
      level: "watch",
      value: "Fair",
      extra: "86 °C",
      driver: "Fair pressure",
      warn: 80,
      stop: 95,
      min: 30,
      max: 120,
      unit: "°C",
      available: true,
      unavailableReason: null,
    },
    {
      id: "memory",
      level: "ok",
      value: "18.2 / 24 GB",
      extra: null,
      driver: "6.1 GB compressed · 3.2 GB swap",
      warn: null,
      stop: null,
      min: 0,
      max: 100,
      unit: "%",
      available: true,
      unavailableReason: null,
    },
  ];
  return {
    machine: { chip: "Apple M4 Pro", cores: 12 },
    intervalMs: 1000,
    gauges,
    history: mockHistory(nowMs),
    verdict: { level: "watch", reasons: ["thermal pressure fair - macOS is limiting performance"] },
    sampledAtMs: nowMs,
  };
}

const MB = 1024 ** 2;

export const MOCK_TOP: ProcessGroupDto[] = [
  {
    key: "/Applications/Cursor.app",
    name: "Cursor Helper (Renderer)",
    sub: "Cursor · 4 processes",
    cpuPct: 22.4,
    memBytes: 1800 * MB,
    memberCount: 4,
    target: { pid: 4101, startedAt: 1_700_000_001 },
    targetIsMain: true,
    targetName: "Cursor",
    killable: true,
    lockReason: null,
  },
  {
    key: "4202:1",
    name: "node",
    sub: "~/dev/app/node_modules/.bin",
    cpuPct: 9.1,
    memBytes: 310 * MB,
    memberCount: 1,
    target: { pid: 4202, startedAt: 1_700_000_002 },
    targetIsMain: false,
    targetName: "node",
    killable: true,
    lockReason: null,
  },
  {
    key: "/Applications/Slack.app",
    name: "Slack Helper (GPU)",
    sub: "Slack · 5 processes",
    cpuPct: 4.6,
    memBytes: 920 * MB,
    memberCount: 5,
    target: { pid: 4303, startedAt: 1_700_000_003 },
    targetIsMain: true,
    targetName: "Slack",
    killable: true,
    lockReason: null,
  },
  {
    key: "/System/Library/CoreServices/WindowServer",
    name: "WindowServer",
    sub: "/System/Library/PrivateFrameworks/SkyLight.framework",
    cpuPct: 3.2,
    memBytes: 410 * MB,
    memberCount: 1,
    target: { pid: 410, startedAt: 1_700_000_004 },
    targetIsMain: false,
    targetName: "WindowServer",
    killable: false,
    lockReason: "system",
  },
  {
    key: "4404:1",
    name: "vite",
    sub: "~/dev/app/node_modules/.bin",
    cpuPct: 1.4,
    memBytes: 120 * MB,
    memberCount: 1,
    target: { pid: 4404, startedAt: 1_700_000_005 },
    targetIsMain: false,
    targetName: "vite",
    killable: true,
    lockReason: null,
  },
];
