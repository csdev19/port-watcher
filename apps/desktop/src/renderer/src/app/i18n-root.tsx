import type { ReactNode } from "react";
import { I18nProvider, messages, type Locale } from "@monorepo-template/i18n";
import { useSettings } from "./settings-context";

/**
 * `I18nProvider` owns no storage by design — it takes `onLocaleChange` to persist
 * and `subscribeExternal` to react to changes made elsewhere. Here both are wired
 * to the main process, which is what keeps the tray menu and the UI in the same
 * language.
 */
export function I18nRoot({ children }: { children: ReactNode }) {
  const { settings, setLocale } = useSettings();

  return (
    <I18nProvider
      initialLocale={settings.locale}
      messagesByLocale={messages}
      onLocaleChange={(locale: Locale) => void setLocale(locale)}
      subscribeExternal={(apply) => window.api.settings.onChanged((next) => apply(next.locale))}
    >
      {children}
    </I18nProvider>
  );
}
