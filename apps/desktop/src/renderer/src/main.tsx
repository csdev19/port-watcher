import "./assets/base.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/app";
import { I18nRoot } from "./app/i18n-root";
import { SettingsProvider } from "./app/settings-context";
import { ThemeEffect } from "./app/theme";

/**
 * Settings are read before the first paint: the persisted locale and theme decide
 * what the very first render looks like, so fetching them afterwards would show a
 * flash of the wrong language and palette.
 */
async function bootstrap(): Promise<void> {
  const settings = await window.api.settings.get();

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <SettingsProvider initialSettings={settings}>
        <ThemeEffect />
        <I18nRoot>
          <App />
        </I18nRoot>
      </SettingsProvider>
    </StrictMode>,
  );
}

void bootstrap();
