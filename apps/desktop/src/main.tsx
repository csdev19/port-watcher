import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import Settings from "./settings/Settings";
import "./tokens.css";
import "./global.css";

const queryClient = new QueryClient();

/** Every window loads this bundle; `?view=` picks what it renders. */
const view = new URLSearchParams(window.location.search).get("view");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      {view === "settings" ? <Settings /> : <App />}
    </QueryClientProvider>
  </React.StrictMode>,
);
