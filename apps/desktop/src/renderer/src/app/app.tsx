import { useState } from "react";
import { useTranslations } from "@monorepo-template/i18n";
import { SettingsPage } from "@renderer/features/settings/settings-page";
import { TodosPage } from "@renderer/features/todos/todos-page";
import styles from "./app.module.css";

const TABS = ["todos", "settings"] as const;
type Tab = (typeof TABS)[number];

/**
 * A two-tab shell. Local state is enough here — a router would earn its place
 * once the app has deep links or more than a handful of screens.
 */
export function App() {
  const [tab, setTab] = useState<Tab>("todos");
  const t = useTranslations();

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <h1 className={styles.brand}>{t("common.appName")}</h1>
        <nav className={styles.nav}>
          {TABS.map((candidate) => (
            <button
              key={candidate}
              type="button"
              className={[styles.tab, candidate === tab && styles.tabActive]
                .filter(Boolean)
                .join(" ")}
              aria-current={candidate === tab ? "page" : undefined}
              onClick={() => setTab(candidate)}
            >
              {candidate === "todos" ? t("nav.todos") : t("settings.title")}
            </button>
          ))}
        </nav>
      </header>

      <main className={styles.main}>
        <div className={styles.content}>{tab === "todos" ? <TodosPage /> : <SettingsPage />}</div>
      </main>
    </div>
  );
}
