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
