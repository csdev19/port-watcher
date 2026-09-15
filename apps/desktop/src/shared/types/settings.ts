import type { Locale } from "@monorepo-template/i18n";

/** Theme preference. "system" follows the OS; the renderer resolves it to light/dark. */
export const THEME_PREFERENCES = ["system", "light", "dark"] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === "string" && (THEME_PREFERENCES as readonly string[]).includes(value);
}

/** Everything the app persists between launches. Kept deliberately small. */
export interface AppSettings {
  locale: Locale;
  theme: ThemePreference;
}
