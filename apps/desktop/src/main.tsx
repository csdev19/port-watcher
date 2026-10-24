import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import Settings from "./settings/Settings";
import Setup from "./setup/Setup";
import { applyCachedAppearance, useAppearance } from "./lib/appearance";
import "@fontsource/geist-sans/latin-400.css";
import "@fontsource/geist-sans/latin-500.css";
import "@fontsource/geist-sans/latin-600.css";
import "@fontsource/geist-mono/latin-400.css";
import "@fontsource/geist-mono/latin-500.css";
import "@port-watcher/tokens/css/panel";
import "./global.css";

const queryClient = new QueryClient();

/** Every window loads this bundle; `?view=` picks what it renders:
 * `setup` is the first-run window, `settings` the Settings window, and
 * anything else the menu-bar panel. */
const view = new URLSearchParams(window.location.search).get("view");

/** `data-window` names the window for CSS; the appearance itself is global. */
const isPanel = view !== "setup" && view !== "settings";
document.documentElement.dataset.window = isPanel ? "panel" : view;
applyCachedAppearance();

function Root() {
  useAppearance();
  if (view === "setup") return <Setup />;
  if (view === "settings") return <Settings />;
  return (
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
