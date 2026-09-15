export const SUPPORTED_LOCALES = ["en", "es"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

/** English is the template default and the source-of-truth catalog. */
export const DEFAULT_LOCALE: Locale = "en";

/**
 * Always pass a time zone to use-intl — Cloudflare Workers (UTC) and most
 * runtimes sit outside any single zone; omitting it breaks date/number
 * formatting. Change this to your app's primary zone if you have one.
 */
export const TIME_ZONE = "UTC";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/** Map a region locale to a supported base: "es-419" → "es", "en-US" → "en", unknown → default. */
export function normalizeLocale(input: string | null | undefined): Locale {
  if (!input) return DEFAULT_LOCALE;
  const base = input.toLowerCase().split("-")[0] ?? "";
  return isLocale(base) ? base : DEFAULT_LOCALE;
}
