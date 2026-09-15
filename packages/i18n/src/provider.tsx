import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { IntlProvider } from "use-intl";
import { TIME_ZONE, type Locale } from "./config";

type Messages = Record<string, unknown>;

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export interface I18nProviderProps {
  initialLocale: Locale;
  messagesByLocale: Record<Locale, Messages>;
  /** Platform persistence: e.g. write a cookie on web, settings on native. */
  onLocaleChange?: (locale: Locale) => void;
  /**
   * React to locale changes made outside this provider (another tab/window/
   * process). Receives an `apply` that sets state WITHOUT re-persisting (avoids
   * a feedback loop) and returns an unsubscribe.
   */
  subscribeExternal?: (apply: (locale: Locale) => void) => () => void;
  children: ReactNode;
}

/**
 * Persistence-agnostic i18n provider. It owns no storage — inject
 * `onLocaleChange` (persist) and optionally `subscribeExternal` (react to
 * out-of-band changes). That single seam lets one provider serve cookie-based
 * web and settings-based native without branching.
 */
export function I18nProvider({
  initialLocale,
  messagesByLocale,
  onLocaleChange,
  subscribeExternal,
  children,
}: I18nProviderProps) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  const setLocale = useCallback(
    (next: Locale) => {
      setLocaleState(next);
      onLocaleChange?.(next);
    },
    [onLocaleChange],
  );

  useEffect(() => {
    if (!subscribeExternal) return;
    return subscribeExternal((next) => setLocaleState(next));
  }, [subscribeExternal]);

  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);

  return (
    <LocaleContext.Provider value={value}>
      <IntlProvider locale={locale} messages={messagesByLocale[locale]} timeZone={TIME_ZONE}>
        {children}
      </IntlProvider>
    </LocaleContext.Provider>
  );
}

export function useLocale(): Locale {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocale must be used within <I18nProvider>");
  return ctx.locale;
}

export function useSetLocale(): (locale: Locale) => void {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useSetLocale must be used within <I18nProvider>");
  return ctx.setLocale;
}
