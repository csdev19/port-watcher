import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Locale } from "@monorepo-template/i18n";
import type { AppSettings, ThemePreference } from "@shared/types";

interface SettingsContextValue {
  settings: AppSettings;
  setLocale: (locale: Locale) => Promise<void>;
  setTheme: (theme: ThemePreference) => Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

/**
 * Mirrors the main process's settings in the renderer.
 *
 * The main process stays the single source of truth — every setter round-trips
 * through IPC and the state is replaced with whatever comes back, so a change
 * made in the tray and one made here converge on the same value.
 */
export function SettingsProvider({
  initialSettings,
  children,
}: {
  initialSettings: AppSettings;
  children: ReactNode;
}) {
  const [settings, setSettings] = useState<AppSettings>(initialSettings);

  useEffect(() => window.api.settings.onChanged(setSettings), []);

  const setLocale = useCallback(async (locale: Locale) => {
    setSettings(await window.api.settings.setLocale(locale));
  }, []);

  const setTheme = useCallback(async (theme: ThemePreference) => {
    setSettings(await window.api.settings.setTheme(theme));
  }, []);

  const value = useMemo(() => ({ settings, setLocale, setTheme }), [settings, setLocale, setTheme]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within <SettingsProvider>");
  return ctx;
}
