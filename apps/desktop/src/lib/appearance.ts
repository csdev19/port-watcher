import { useEffect } from "react";
import { readCachedSetting, useSetting, type Settings } from "../settings/store";
import { inTauri } from "./ports";
import { syncPanelTheme } from "./theme";

export type Appearance = Settings["appearance"];

/** Sets or clears `<html data-theme>`. No attribute means "follow the system". */
export function setDomTheme(value: Appearance, root: HTMLElement = document.documentElement): void {
  if (value === "dark" || value === "light") root.dataset.theme = value;
  else delete root.dataset.theme;
}

/** Applies the last known appearance synchronously, before the first render,
 * so a window never flashes the wrong theme while the store loads. */
export function applyCachedAppearance(root: HTMLElement = document.documentElement): void {
  setDomTheme(readCachedSetting("appearance"), root);
}

/**
 * Applies the appearance to this window: `data-theme` for the page and, in
 * Tauri, the native window theme (title bar, traffic lights). `null` hands
 * the native theme back to macOS. A refused `setTheme` is ignored: the page
 * themes correctly through `data-theme` anyway.
 *
 * "system" clears `data-theme` and then lets `syncPanelTheme` mirror the
 * window theme, which also covers a webview that does not re-evaluate
 * `prefers-color-scheme` live.
 *
 * Returns a cleanup function.
 */
export function applyAppearance(
  value: Appearance,
  root: HTMLElement = document.documentElement,
): () => void {
  setDomTheme(value, root);
  if (!inTauri) return () => {};
  let stop: (() => void) | undefined;
  void (async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().setTheme(value === "system" ? null : value);
    } catch {
      // Not permitted or unsupported (e.g. the NSPanel): data-theme is enough.
    }
  })();
  if (value === "system") stop = syncPanelTheme(root);
  return () => stop?.();
}

/** Keeps this window's theme in step with the saved Appearance setting. */
export function useAppearance(): void {
  const [appearance] = useSetting("appearance");
  useEffect(() => applyAppearance(appearance), [appearance]);
}
