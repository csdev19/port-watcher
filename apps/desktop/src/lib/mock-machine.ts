import type {
  GaugeDto,
  HistoryPoint,
  MachineSnapshot,
  Metric,
  ProcessGroupDto,
  Range,
  SeriesDto,
} from "@/lib/machine-types";

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
    systemWatts: 18.4,
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
    gpuPct: 8.4,
    members: [
      { pid: 4101, startedAt: 1_700_000_001 },
      { pid: 4102, startedAt: 1_700_000_002 },
      { pid: 4103, startedAt: 1_700_000_003 },
      { pid: 4104, startedAt: 1_700_000_004 },
    ],
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
    gpuPct: null,
    members: [{ pid: 4202, startedAt: 1_700_000_002 }],
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
    gpuPct: 1.2,
    members: [{ pid: 4303, startedAt: 1_700_000_003 }],
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
    gpuPct: 3.0,
    members: [{ pid: 410, startedAt: 1_700_000_004 }],
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
    gpuPct: null,
    members: [{ pid: 4404, startedAt: 1_700_000_005 }],
  },
];

const RANGE_BUCKETS: Record<Range, [number, number]> = {
  "1m": [1000, 60],
  "10m": [5000, 120],
  "1h": [20_000, 180],
};

/** A believable series for the browser dev loop. The oldest quarter is "not sampled" on the 1 h
 * range so the gap rendering can be seen. */
export function mockSeries(metric: Metric, range: Range, nowMs: number = Date.now()): SeriesDto {
  const [bucketMs, n] = RANGE_BUCKETS[range];
  const base: Record<Metric, [number, number]> = {
    cpu: [22, 40],
    gpu: [8, 20],
    memoryUsed: [74, 3],
    hotspot: [58, 38],
    thermalLevel: [0, 2],
  };
  const [lo, span] = base[metric];
  const buckets: SeriesDto["buckets"] = [];
  let peak: SeriesDto["peak"] = null;
  for (let i = 0; i < n; i++) {
    const tMs = nowMs - (n - 1 - i) * bucketMs;
    if (range === "1h" && i < n / 4) {
      buckets.push(null);
      continue;
    }
    const avg =
      metric === "thermalLevel" ? Math.round(lo + span * wave(i, 25)) : lo + span * wave(i, 7);
    buckets.push({ tMs, min: avg - 2, avg, max: avg + 3 });
    if (!peak || avg + 3 > peak.value) {
      peak = { tMs, value: avg + 3, top: { name: "Cursor", cpuPct: 38 } };
    }
  }
  return { metric, range, bucketMs, endMs: nowMs, buckets, peak };
}
