import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePorts } from "@/hooks/use-ports";
import { useListNavigation } from "@/hooks/use-list-navigation";
import { filterPorts } from "@/lib/filter";
import { inTauri, killPort } from "@/lib/ports";
import { portKey, type PortEntry } from "@/lib/types";
import { PortList } from "@/components/PortList";
import { SearchInput } from "@/components/SearchInput";
import { EmptyState, ErrorState, FilteredEmptyState } from "@/components/PanelStates";
import { Toast, type ToastData } from "@/components/Toast";
import styles from "@/app.module.css";

async function hidePanel() {
  if (!inTauri) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().hide();
}

export default function App() {
  const queryClient = useQueryClient();
  const { data, error, refetch, dataUpdatedAt } = usePorts();
  const [query, setQuery] = useState("");
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastData | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const entries = useMemo(() => filterPorts(data ?? [], query), [data, query]);
  const nav = useListNavigation(entries);
  const selectedIndex = entries.findIndex((e) => portKey(e) === nav.selectedKey);

  async function handleKill(entry: PortEntry) {
    try {
      const result = await killPort(entry);
      if (result === "terminated" || result === "killed") {
        setToast({ message: `${entry.label} (${entry.port}) stopped`, command: entry.command });
        queryClient.invalidateQueries({ queryKey: ["ports"] });
      } else if (result === "alreadyGone") {
        setToast({ message: `${entry.label} (${entry.port}) was already gone`, command: null });
        queryClient.invalidateQueries({ queryKey: ["ports"] });
      } else {
        setToast({ message: `Cannot kill ${entry.label} (${entry.port})`, command: null });
      }
    } catch (err) {
      setToast({
        message: `Could not kill ${entry.label} (${entry.port}): ${String(err)}`,
        command: null,
      });
    }
  }

  // Keyboard drives the list even while the search input owns focus.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const action = nav.onKeyDown(e);
      const current = entries.find((entry) => portKey(entry) === nav.selectedKey);
      if (action === "expand" && current) {
        const k = portKey(current);
        setExpandedKey((prev) => (prev === k ? null : k));
      } else if (action === "kill" && current?.killable) {
        void handleKill(current);
      } else if (action === "close") {
        void hidePanel();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Shell emits panel-shown on every open: instant refetch + focus.
  useEffect(() => {
    if (!inTauri) return;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/event").then(async ({ listen }) => {
      unlisten = await listen("panel-shown", () => {
        void refetch();
        searchRef.current?.focus();
        searchRef.current?.select();
      });
    });
    return () => unlisten?.();
  }, [refetch]);

  // Production only: the webview's native context menu is another OS
  // overlay over the transparent panel, and its items (Reload, etc.)
  // make no sense here. Dev keeps right-click → Inspect Element.
  useEffect(() => {
    if (!import.meta.env.PROD) return;
    const preventContextMenu = (event: MouseEvent) => event.preventDefault();
    window.addEventListener("contextmenu", preventContextMenu);
    return () => window.removeEventListener("contextmenu", preventContextMenu);
  }, []);

  // Toasts self-dismiss; keeping one visible while it has a copy action.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const updatedSecondsAgo = Math.max(0, Math.round((Date.now() - dataUpdatedAt) / 1000));

  return (
    <main className={styles.panel}>
      <SearchInput ref={searchRef} value={query} onChange={setQuery} />
      {error && !data ? (
        <ErrorState message={String(error)} onRetry={() => void refetch()} />
      ) : entries.length > 0 ? (
        <PortList
          entries={entries}
          selected={selectedIndex}
          expandedKey={expandedKey}
          onSelect={nav.setSelectedKey}
          onToggleExpand={(k) => setExpandedKey((prev) => (prev === k ? null : k))}
          onKill={(entry) => void handleKill(entry)}
        />
      ) : query.trim() !== "" ? (
        <FilteredEmptyState query={query} onClear={() => setQuery("")} />
      ) : (
        <EmptyState />
      )}
      <footer className={styles.footer}>
        {data
          ? `${entries.length} ports · updated ${updatedSecondsAgo}s ago${error ? " (update failed)" : ""}`
          : "loading…"}
      </footer>
      {toast && (
        <Toast
          toast={toast}
          onCopy={() => {
            if (toast.command) {
              navigator.clipboard
                .writeText(toast.command)
                .catch(() => setToast({ message: "Could not copy command", command: null }));
            }
            setToast(null);
          }}
        />
      )}
    </main>
  );
}
