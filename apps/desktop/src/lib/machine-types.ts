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
  killable: boolean;
  lockReason: LockReason | null;
}
