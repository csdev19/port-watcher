import { join } from "node:path";
import { Menu, Tray, nativeImage, type BrowserWindow } from "electron";
import { createAppTranslator } from "@monorepo-template/i18n/core";
import { SUPPORTED_LOCALES, type Locale } from "@monorepo-template/i18n";
import type { AppSettings } from "@shared/types";

/** Explicit map, so a new locale fails to compile until its label is added. */
const LOCALE_LABEL_KEY: Record<Locale, "language.en" | "language.es"> = {
  en: "language.en",
  es: "language.es",
};

export interface AppTray {
  /** Rebuild the menu — call it whenever settings change. */
  refresh: () => void;
  destroy: () => void;
}

/**
 * The tray menu is why the main process needs i18n at all: it is native chrome
 * drawn by the OS, so React never sees it. `createAppTranslator` reads the same
 * catalog the renderer uses, without pulling in React.
 */
export function createTray(params: {
  window: BrowserWindow;
  getSettings: () => AppSettings;
  onLocaleChange: (locale: Locale) => void;
  onQuit: () => void;
}): AppTray {
  const { window, getSettings, onLocaleChange, onQuit } = params;

  // electron-builder unpacks `resources/` next to the built main bundle, so
  // resolve against __dirname rather than the process cwd.
  const tray = new Tray(nativeImage.createFromPath(join(__dirname, "../../resources/tray.png")));

  const refresh = (): void => {
    const { locale } = getSettings();
    const t = createAppTranslator(locale);

    tray.setToolTip(t("common.appName"));
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: t("tray.show"),
          click: () => {
            window.show();
            window.focus();
          },
        },
        { type: "separator" },
        {
          label: t("language.label"),
          submenu: SUPPORTED_LOCALES.map((candidate) => ({
            label: t(LOCALE_LABEL_KEY[candidate]),
            type: "radio" as const,
            checked: candidate === locale,
            click: () => onLocaleChange(candidate),
          })),
        },
        { type: "separator" },
        { label: t("tray.quit"), click: onQuit },
      ]),
    );
  };

  refresh();

  return { refresh, destroy: () => tray.destroy() };
}
