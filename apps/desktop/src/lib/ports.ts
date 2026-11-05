import { invoke } from "@tauri-apps/api/core";
import { MOCK_PORTS } from "./mock-ports";
import type { KillResult, PortEntry } from "./types";

/** True inside the real Tauri webview; false in the browser dev loop. */
export const inTauri = "__TAURI_INTERNALS__" in window;

export async function listPorts(): Promise<PortEntry[]> {
  if (!inTauri) return MOCK_PORTS;
  return invoke<PortEntry[]>("list_ports");
}

/** Passes startedAt back so the Rust side can refuse a recycled PID. */
export async function killPort(entry: PortEntry): Promise<KillResult> {
  if (!inTauri) {
    return entry.killable ? "terminated" : "permissionDenied";
  }
  return invoke<KillResult>("kill_port", {
    pid: entry.pid,
    port: entry.port,
    startedAt: entry.startedAt,
  });
}

/** The Settings window's sections. Rust accepts only these ids
 * (`settings::known_section` in src-tauri/src/settings.rs). */
export type SettingsSection = "general" | "ports" | "thermal" | "permissions" | "about";

/** Opens the Settings window, on `section` when given (no-op in the
 * browser dev loop). An already open window switches to that section. */
export async function openSettings(section?: SettingsSection): Promise<void> {
  if (!inTauri) return;
  await invoke("open_settings", { section });
}
