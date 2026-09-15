import type { ReactElement } from "react";
import { render as rtlRender } from "@testing-library/react";
import { I18nRoot } from "@renderer/app/i18n-root";
import { SettingsProvider } from "@renderer/app/settings-context";
import type { AppSettings } from "@shared/types";

const DEFAULT_SETTINGS: AppSettings = { locale: "en", theme: "system" };

/** Renders inside the same providers `main.tsx` mounts, so components see real translations. */
export function renderWithProviders(ui: ReactElement, settings: AppSettings = DEFAULT_SETTINGS) {
  return rtlRender(
    <SettingsProvider initialSettings={settings}>
      <I18nRoot>{ui}</I18nRoot>
    </SettingsProvider>,
  );
}
