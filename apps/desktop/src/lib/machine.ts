import { invoke } from "@tauri-apps/api/core";
import { inTauri } from "@/lib/ports";
import { MOCK_TOP, mockMachineSnapshot } from "@/lib/mock-machine";
import type { KillResult } from "@/lib/types";
import type { MachineSnapshot, ProcessGroupDto } from "@/lib/machine-types";

/** Gauges, verdict and the last 60 s of history. Rust samples at most once per 900 ms. */
export async function machineSnapshot(): Promise<MachineSnapshot> {
  if (!inTauri) return mockMachineSnapshot();
  return invoke<MachineSnapshot>("machine_snapshot", { windowS: 60 });
}

/** Top processes by CPU, grouped by app bundle. */
export async function topProcesses(limit = 5): Promise<ProcessGroupDto[]> {
  if (!inTauri) return MOCK_TOP.slice(0, limit);
  return invoke<ProcessGroupDto[]>("top_processes", { limit });
}

/** Kills ONE process. Rust re-validates (pid + start time, owner, system policy) and refuses
 * what the row should not have offered. */
export async function killProcess(target: { pid: number; startedAt: number }): Promise<KillResult> {
  if (!inTauri) return "terminated";
  return invoke<KillResult>("kill_process", {
    pid: target.pid,
    startedAt: target.startedAt,
  });
}
