import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { inTauri } from "@/lib/ports";
import type { Level } from "@/lib/machine-types";

/** Mirrors of the Rust types in src-tauri/src/alerts/mod.rs (serde camelCase). Do not add
 * fields here without adding them there first. */
export type AlertRuleId =
  | "thermalPressure"
  | "hotspot"
  | "memoryPressure"
  | "cpuSustained"
  | "gpuSustained"
  | "watchedPortTaken";

/** The `settings.json` key holding each rule's on/off switch. */
export const ALERT_SETTING_KEYS = {
  thermalPressure: "alertThermalPressure",
  hotspot: "alertHotspot",
  memoryPressure: "alertMemoryPressure",
  cpuSustained: "alertCpuSustained",
  gpuSustained: "alertGpuSustained",
  watchedPortTaken: "alertWatchedPortTaken",
} as const satisfies Record<AlertRuleId, string>;

export type FocusTarget =
  | { kind: "process"; pid: number; startedAt: number }
  | { kind: "port"; port: number };

export interface Culprit {
  pid: number;
  startedAt: number;
  name: string;
  /** From the Rust kill policy (ADR 0006); the band shows a kill button only when true. */
  killable: boolean;
}

export interface ActiveAlert {
  /** "health:thermalPressure" or "ports:5173". */
  id: string;
  rule: AlertRuleId;
  level: Level;
  title: string;
  /** What the rule saw: "97 °C", "Serious", "Vite". */
  reading: string;
  culprit: Culprit | null;
  sinceEpochMs: number;
  target: FocusTarget | null;
}

export interface AlertRule {
  id: AlertRuleId;
  title: string;
  sub: string;
  enabled: boolean;
  firing: boolean;
}

export const ALERTS_CHANGED_EVENT = "alerts-changed";
export const ALERT_FOCUS_EVENT = "alert-focus";

export async function getActiveAlerts(): Promise<ActiveAlert[]> {
  if (!inTauri) return [];
  return invoke<ActiveAlert[]>("get_active_alerts");
}

export async function listAlertRules(): Promise<AlertRule[]> {
  if (!inTauri) return [];
  return invoke<AlertRule[]>("list_alert_rules");
}

/** Subscribes to `event`; returns the unsubscribe function. A no-op outside Tauri. */
export function listenTo<T>(event: string, onEvent: (payload: T) => void): () => void {
  if (!inTauri) return () => {};
  let unlisten: (() => void) | undefined;
  let cancelled = false;
  void listen<T>(event, (e) => onEvent(e.payload)).then((fn) => {
    if (cancelled) fn();
    else unlisten = fn;
  });
  return () => {
    cancelled = true;
    unlisten?.();
  };
}
