/** Mirrors of the Rust DTOs in src-tauri/src/machine/dto.rs (serde camelCase).
 * Do not add fields here without adding them there first. Levels are decided in Rust; the
 * renderer never compares numbers against thresholds. */

export type Level = "ok" | "watch" | "stop";

export type GaugeId = "cpu" | "gpu" | "heat" | "memory";

export interface GaugeDto {
  id: GaugeId;
  level: Level;
  /** "34%", "Fair", "18.2 / 24 GB", or "n/a". */
  value: string;
  /** A second figure beside the value, for example the Heat hotspot "115 °C". */
  extra: string | null;
  /** What drives the number: "Cursor Helper 22% · 12 cores". */
  driver: string;
  /** The same numbers draw the sparkline lines and the band words. */
  warn: number | null;
  stop: number | null;
  min: number;
  max: number;
  unit: "%" | "°C" | "level";
  available: boolean;
  unavailableReason: string | null;
}

export interface HistoryPoint {
  atMs: number;
  cpu: number | null;
  gpu: number | null;
  heat: number | null;
  /** Thermal pressure 0 (nominal) to 3 (critical). */
  heatLevel: number | null;
  memUsedPct: number;
}

export interface MachineSnapshot {
  machine: { chip: string; cores: number };
  intervalMs: number;
  gauges: GaugeDto[];
  history: HistoryPoint[];
  verdict: { level: Level; reasons: string[] };
  sampledAtMs: number;
  /** Whole-system power in watts, or null when the SMC does not report it. */
  systemWatts: number | null;
}

export type LockReason = "system" | "otherUser" | "self";

export interface ProcessGroupDto {
  key: string;
  name: string;
  /** "Cursor · 4 processes" or the executable's folder. */
  sub: string;
  /** Share of the whole machine, 0 to 100. */
  cpuPct: number;
  memBytes: number;
  memberCount: number;
  /** The one process the kill button signals. */
  target: { pid: number; startedAt: number } | null;
  targetIsMain: boolean;
  /** The target process's own name: the app for a main process, not the heaviest helper. */
  targetName: string;
  killable: boolean;
  lockReason: LockReason | null;
  /** Share of the GPU's time, summed over the members; null when macOS reports none. */
  gpuPct: number | null;
  /** Every process of the row, to join other data by PID plus start time. */
  members: { pid: number; startedAt: number }[];
}

/** Charted metrics. Heat charts the CPU hotspot, plus `thermalLevel` as a strip. */
export type Metric = "cpu" | "gpu" | "memoryUsed" | "hotspot" | "thermalLevel";
export type Range = "1m" | "10m" | "1h";

export interface SeriesBucket {
  /** End of the bucket's time slot, epoch ms. */
  tMs: number;
  min: number;
  avg: number;
  max: number;
}

/** One metric over a range, downsampled in Rust. A `null` bucket was not sampled. */
export interface SeriesDto {
  metric: Metric;
  range: Range;
  bucketMs: number;
  endMs: number;
  buckets: (SeriesBucket | null)[];
  peak: {
    tMs: number;
    value: number;
    top: { name: string; cpuPct: number } | null;
  } | null;
}
