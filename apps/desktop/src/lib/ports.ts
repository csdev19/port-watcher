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

/** Opens the Settings window (no-op in the browser dev loop). */
export async function openSettings(): Promise<void> {
  if (!inTauri) return;
  await invoke("open_settings");
}

/** Quits the app, like the tray menu's Quit (no-op in the browser dev loop). */
export async function quitApp(): Promise<void> {
  if (!inTauri) return;
  await invoke("quit_app");
}

/** Opens http://localhost:<port> in the default browser (no-op in the browser
 * dev loop). The panel's opener permission is scoped to localhost and
 * 127.0.0.1 only (capabilities/default.json), so this can open nothing else. */
export async function openLocalUrl(port: number): Promise<void> {
  if (!inTauri) return;
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(`http://localhost:${port}`);
}
