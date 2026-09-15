import { DEFAULT_LOCALE, normalizeLocale, type Locale } from "./config";

export const LOCALE_COOKIE = "LOCALE";

/** Browser: cookie → navigator.language → default. */
export function detectLocaleWeb(): Locale {
  const fromCookie = readCookie(LOCALE_COOKIE);
  if (fromCookie) return normalizeLocale(fromCookie);
  if (typeof navigator !== "undefined") return normalizeLocale(navigator.language);
  return DEFAULT_LOCALE;
}

export function persistLocaleWeb(locale: Locale): void {
  document.cookie = `${LOCALE_COOKIE}=${locale};path=/;max-age=${60 * 60 * 24 * 365};SameSite=Lax`;
}

/** Server (SSR): cookie → Accept-Language → default. Parses only the primary subtag. */
export function detectLocaleFromRequest(req: Request): Locale {
  const cookieHeader = req.headers.get("cookie") ?? "";
  const match = cookieHeader.match(new RegExp(`${LOCALE_COOKIE}=([^;]+)`));
  if (match?.[1]) return normalizeLocale(match[1]);
  const accept = req.headers.get("accept-language");
  if (accept) return normalizeLocale(accept.split(",")[0]);
  return DEFAULT_LOCALE;
}

function readCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  return document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${name}=`))
    ?.split("=")[1];
}
