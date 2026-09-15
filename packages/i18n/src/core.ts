import "./app-config";
import { createTranslator } from "use-intl/core";
import type { Messages } from "use-intl";
import en from "../messages/en.json";
import es from "../messages/es.json";
import { TIME_ZONE, type Locale } from "./config";

const messagesByLocale = { en, es } as Record<Locale, Messages>;

/**
 * A translator usable anywhere React isn't (server functions, background jobs,
 * a native main process). Uses use-intl's non-React core with the same JSON
 * catalog. Call with full, namespaced keys, e.g. `t("common.save")`.
 */
export function createAppTranslator(locale: Locale) {
  return createTranslator({
    locale,
    messages: messagesByLocale[locale],
    timeZone: TIME_ZONE,
  });
}
