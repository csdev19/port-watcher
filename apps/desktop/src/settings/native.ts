import { invoke } from "@tauri-apps/api/core";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { inTauri } from "../lib/ports";

/*
 * The Settings window's calls into the OS and the Rust core. Outside
 * Tauri (browser dev loop, tests) they succeed against in-memory state.
 */

/** Re-registers the global shortcut. Rejects with the reason when refused. */
export async function registerShortcut(shortcut: string): Promise<void> {
  if (!inTauri) return;
  await invoke("set_shortcut", { shortcut });
}

let memoryAutostart = false;

/** The OS is the source of truth for launch at login; nothing is stored in settings.json. */
export async function getAutostart(): Promise<boolean> {
  if (!inTauri) return memoryAutostart;
  return isEnabled();
}

export async function setAutostart(on: boolean): Promise<void> {
  if (!inTauri) {
    memoryAutostart = on;
    return;
  }
  await (on ? enable() : disable());
}
