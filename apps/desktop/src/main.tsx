import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import Setup from "./setup/Setup";
import "./global.css";

const queryClient = new QueryClient();

// The Rust side opens the first-run window with `index.html?view=setup`;
// every other window is the menu-bar panel.
const isSetup = new URLSearchParams(window.location.search).get("view") === "setup";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isSetup ? (
      <Setup />
    ) : (
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    )}
  </React.StrictMode>,
);
