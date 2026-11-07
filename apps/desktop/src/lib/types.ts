/** Mirror of Rust `PortCategory`. UX grouping and confirmation friction;
 * the Rust kill path also refuses `system` on its own, re-deriving the
 * category from the live process. */
export type PortCategory = "dev" | "app" | "system";

/** Mirror of Rust `PortEntry` (serde camelCase). Do not add fields here
 * without adding them in src-tauri/src/ports/models.rs first. */
export interface PortEntry {
  port: number;
  pid: number;
  processName: string;
  command: string;
  cwd: string | null;
  project: string | null;
  label: string;
  user: string | null;
  /** Epoch seconds; doubles as the kill guard. */
  startedAt: number;
  memoryBytes: number;
  killable: boolean;
  category: PortCategory;
  /** Full executable path when available. */
  executablePath: string | null;
  /** Full path through the outermost `.app` component, when available. */
  appBundlePath: string | null;
}

/** Mirror of Rust `KillResult`. */
export type KillResult = "terminated" | "killed" | "alreadyGone" | "permissionDenied";

/** Identity key for a listening process (pid + port, not array index).
 * The list is re-sorted by (port, pid) on every poll, so an index can
 * silently point at a different row after a refetch — this key can't. */
export function portKey(entry: Pick<PortEntry, "pid" | "port">): string {
  return `${entry.pid}:${entry.port}`;
}

/** Where a row is drawn on the panel's Ports tab. A port that is both a
 * favourite and listening is drawn twice, once in each. */
export type RowScope = "favourites" | "listening";

/** Selection, detail and kill-arm key for one drawn row: its scope plus
 * `portKey`, so the two copies of one process are two distinct rows to the
 * keyboard and only the copy acted on highlights or arms. */
export function rowKey(scope: RowScope, entry: Pick<PortEntry, "pid" | "port">): string {
  return `${scope}:${portKey(entry)}`;
}

/** Mirror of the Rust thermal types (serde camelCase); the contract is in
 * docs/specs/2026-11-04-temperature-guard-design.md. Do not add fields here
 * without adding them in src-tauri/src/thermal first. */
export type ThermalState = "nominal" | "fair" | "serious" | "critical";
export type ThermalBand = "cool" | "normal" | "warm" | "hot" | "throttling";

export interface ThermalReading {
  avgC: number;
  maxC: number;
  sensors: number;
  state: ThermalState;
  band: ThermalBand;
  /** Epoch seconds. */
  at: number;
  /** 7-day average of the average die temperature; null before there is history. */
  baselineC: number | null;
}

export interface ThermalBucket {
  startS: number;
  minC: number;
  avgC: number;
  maxAvgC: number;
  /** Hottest single sensor. */
  maxC: number;
  worstState: ThermalState;
  samples: number;
}

export interface ThermalProcess {
  pid: number;
  name: string;
  cpu: number;
  ports: number[];
}

export interface ThermalPeak {
  id: number;
  atS: number;
  avgC: number;
  maxC: number;
  state: ThermalState;
  processes: ThermalProcess[];
}

export interface ThermalDay {
  /** Local date, YYYY-MM-DD. */
  day: string;
  minC: number;
  avgC: number;
  maxC: number;
  seriousMinutes: number;
}

export interface ThermalHistory {
  available: boolean;
  buckets: ThermalBucket[];
  peaks: ThermalPeak[];
  days: ThermalDay[];
}

/** Mirror of the Rust memory types (serde camelCase, src-tauri/src/memory/api.rs);
 * the contract is in docs/specs/2026-11-07-memory-guard-design.md. Do not add
 * fields here without adding them in src-tauri/src/memory first. */
export type MemoryPressure = "normal" | "warning" | "critical";
export type MemoryVerdict = "ok" | "watch" | "stop";
export type MemorySignal = "pressure" | "swap" | "bigProcess" | "growing";

export interface MemoryThresholds {
  /** Swap used, % of swap total, that raises WATCH. Default 80. */
  swapWatchPct: number;
  /** Swap used, %, that together with a big process raises STOP. Default 95. */
  swapStopPct: number;
  /** One process at or above this % of physical RAM is "big". Default 25. */
  bigProcessPct: number;
  /** A process whose footprint grew by this factor is "growing". Default 2. */
  growthFactor: number;
  /** ...and only when it also exceeds this many bytes. Default 2 GiB. */
  growthMinBytes: number;
}

export interface MemoryCommand {
  /** "sudo launchctl kickstart -k system/com.x.y" or "sudo kill 123". */
  text: string;
  kind: "kickstart" | "kill";
  /** One line of context (ADR 0012). */
  note: string;
  securityVendor: string | null;
}

export interface MemoryProcess {
  pid: number;
  /** Epoch seconds; identity with pid. */
  startedAt: number;
  name: string;
  executablePath: string | null;
  user: string | null;
  /** phys_footprint, not RSS. */
  footprintBytes: number;
  /** First retained sample of this incarnation; null if none. */
  firstFootprintBytes: number | null;
  firstSampleAt: number | null;
  /** A subset of "bigProcess" | "growing". */
  flags: MemorySignal[];
  /** Rust's `is_killable`, same policy as Ports. */
  killable: boolean;
  /** Listening ports, [] if none. */
  ports: number[];
  /** Present only when !killable. */
  command: MemoryCommand | null;
}

export interface MemoryReading {
  /** Epoch seconds. */
  at: number;
  totalBytes: number;
  /** App + wired + compressed, as Activity Monitor counts it. */
  usedBytes: number;
  compressedBytes: number;
  swapUsedBytes: number;
  swapTotalBytes: number;
  pressure: MemoryPressure;
  verdict: MemoryVerdict;
  /** Ordered as in the spec table. */
  reasons: MemorySignal[];
  /** Top 8 by footprint. */
  top: MemoryProcess[];
}

export interface MemoryBucket {
  startS: number;
  usedAvgBytes: number;
  usedMaxBytes: number;
  swapAvgBytes: number;
  swapMaxBytes: number;
  worstPressure: MemoryPressure;
  samples: number;
}

export interface MemoryDay {
  /** Local date, YYYY-MM-DD. */
  day: string;
  swapMaxBytes: number;
  usedMaxBytes: number;
  /** Minutes at pressure >= warning. */
  warningMinutes: number;
}

export interface MemoryHistory {
  available: boolean;
  buckets: MemoryBucket[];
  days: MemoryDay[];
}
