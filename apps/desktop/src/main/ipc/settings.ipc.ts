import { BrowserWindow, ipcMain, nativeTheme } from "electron";
import { isLocale } from "@monorepo-template/i18n";
import { IPC, isThemePreference, type AppSettings } from "@shared/types";
import type { SettingsStore } from "../infrastructure/settings-store";

export interface SettingsIpc {
  /**
   * Persist a change, push it to the OS and to every window, and notify the
   * caller. Use it for changes made outside the renderer (e.g. the tray menu).
   */
  apply: (patch: Partial<AppSettings>) => AppSettings;
}

/**
 * Wires the settings store to the renderer. Every path — renderer or tray —
 * funnels through `apply`, so the persisted file, `nativeTheme`, the tray menu
 * and every open window can never disagree.
 */
export function registerSettingsIpc(
  store: SettingsStore,
  options: { onChanged?: (settings: AppSettings) => void } = {},
): SettingsIpc {
  const apply = (patch: Partial<AppSettings>): AppSettings => {
    const settings = store.update(patch);

    // Electron owns the native chrome (title bar, menus, scrollbars), so the
    // preference has to reach nativeTheme too — not just the renderer's CSS.
    nativeTheme.themeSource = settings.theme;

    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IPC.settings.changed, settings);
    }
    options.onChanged?.(settings);

    return settings;
  };

  ipcMain.handle(IPC.settings.get, () => store.get());

  ipcMain.handle(IPC.settings.setLocale, (_event, locale: unknown) => {
    if (!isLocale(locale)) throw new Error(`Unsupported locale: ${String(locale)}`);
    return apply({ locale });
  });

  ipcMain.handle(IPC.settings.setTheme, (_event, theme: unknown) => {
    if (!isThemePreference(theme)) throw new Error(`Unsupported theme: ${String(theme)}`);
    return apply({ theme });
  });

  // Reflect the persisted preference before any window is shown.
  nativeTheme.themeSource = store.get().theme;

  return { apply };
}
