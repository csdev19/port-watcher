import { invoke } from "@tauri-apps/api/core";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { inTauri } from "../lib/ports";
import { ALERT_SETTING_KEYS, type AlertRuleId } from "../lib/alerts";
import { setSetting } from "./store";

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

/**
 * Turns an alert rule on or off. Rust reconfigures the engine first and the setting is saved
 * only after it accepts, so a refused change leaves both sides as they were.
 */
export async function setAlertRuleEnabled(rule: AlertRuleId, enabled: boolean): Promise<void> {
  if (inTauri) await invoke("set_alert_rule_enabled", { rule, enabled });
  await setSetting(ALERT_SETTING_KEYS[rule], enabled);
}
