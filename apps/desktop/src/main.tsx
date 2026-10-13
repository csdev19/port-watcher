import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import Settings from "./settings/Settings";
import Setup from "./setup/Setup";
import "./tokens.css";
import "./global.css";

const queryClient = new QueryClient();

/** Every window loads this bundle; `?view=` picks what it renders:
 * `setup` is the first-run window, `settings` the Settings window, and
 * anything else the menu-bar panel. */
const view = new URLSearchParams(window.location.search).get("view");

function Root() {
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
