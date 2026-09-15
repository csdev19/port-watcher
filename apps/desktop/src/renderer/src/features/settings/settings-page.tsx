import { SUPPORTED_LOCALES, isLocale, useTranslations } from "@monorepo-template/i18n";
import { THEME_PREFERENCES, isThemePreference } from "@shared/types";
import { useSettings } from "@renderer/app/settings-context";
import { Card } from "@renderer/ui/card";
import { Select } from "@renderer/ui/select";
import styles from "./settings.module.css";

/** Message keys, mapped explicitly so a new value fails to compile until translated. */
const LOCALE_LABEL = { en: "language.en", es: "language.es" } as const;
const THEME_LABEL = {
  system: "settings.themeSystem",
  light: "settings.themeLight",
  dark: "settings.themeDark",
} as const;

export function SettingsPage() {
  const t = useTranslations();
  const { settings, setLocale, setTheme } = useSettings();

  return (
    <Card title={t("settings.title")} description={t("settings.description")}>
      <div className={styles.row}>
        <div>
          <div className={styles.label}>{t("language.label")}</div>
          <p className={styles.hint}>{t("settings.languageHint")}</p>
        </div>
        <Select
          value={settings.locale}
          aria-label={t("language.label")}
          onChange={(event) => {
            const next = event.target.value;
            if (isLocale(next)) void setLocale(next);
          }}
        >
          {SUPPORTED_LOCALES.map((locale) => (
            <option key={locale} value={locale}>
              {t(LOCALE_LABEL[locale])}
            </option>
          ))}
        </Select>
      </div>

      <div className={styles.row}>
        <div>
          <div className={styles.label}>{t("settings.theme")}</div>
          <p className={styles.hint}>{t("settings.themeHint")}</p>
        </div>
        <Select
          value={settings.theme}
          aria-label={t("settings.theme")}
          onChange={(event) => {
            const next = event.target.value;
            if (isThemePreference(next)) void setTheme(next);
          }}
        >
          {THEME_PREFERENCES.map((theme) => (
            <option key={theme} value={theme}>
              {t(THEME_LABEL[theme])}
            </option>
          ))}
        </Select>
      </div>
    </Card>
  );
}
