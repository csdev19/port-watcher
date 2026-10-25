import { invoke } from "@tauri-apps/api/core";
import { inTauri } from "./ports";

/** Probes Full Disk Access. Never triggers a macOS prompt (the Rust side
 * only tries to open a file that FDA-holders can read). False outside the
 * Tauri webview, so the browser dev loop stays on the Waiting screen. */
export async function checkFullDiskAccess(): Promise<boolean> {
  if (!inTauri) return false;
  return invoke<boolean>("check_full_disk_access");
}

/** Opens System Settings at Privacy & Security > Full Disk Access. */
export async function openFullDiskAccessSettings(): Promise<void> {
  if (!inTauri) return;
  await invoke("open_full_disk_access_settings");
}

/** Opens System Settings at Notifications (chapay cannot read that permission's state). */
export async function openNotificationSettings(): Promise<void> {
  if (!inTauri) return;
  await invoke("open_notification_settings");
}

/** Closes the setup window and opens the panel. */
export async function finishSetup(): Promise<void> {
  if (!inTauri) return;
  await invoke("finish_setup");
}

/** Opens the first-run setup window again (from Settings › Permissions). */
export async function showSetupWindow(): Promise<void> {
  if (!inTauri) return;
  await invoke("show_setup_window");
}
