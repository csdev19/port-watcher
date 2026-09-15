import "./app-config";
import en from "../messages/en.json";
import es from "../messages/es.json";
import type { Locale } from "./config";

/** Concrete, JSON-serializable shape of a message catalog (from the en source). */
export type Messages = typeof en;

/** Ready-to-pass bundle for <I18nProvider messagesByLocale={messages}>. */
export const messages = { en, es } as Record<Locale, Messages>;

export { useTranslations, useFormatter, useNow, useTimeZone } from "use-intl";
export { I18nProvider, useLocale, useSetLocale } from "./provider";
export type { I18nProviderProps } from "./provider";
export { SUPPORTED_LOCALES, DEFAULT_LOCALE, TIME_ZONE, isLocale, normalizeLocale } from "./config";
export type { Locale } from "./config";
