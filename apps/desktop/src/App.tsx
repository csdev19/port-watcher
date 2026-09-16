import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePorts } from "@/hooks/use-ports";
import { useListNavigation } from "@/hooks/use-list-navigation";
import { useKillConfirm } from "@/hooks/use-kill-confirm";
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

/** Key used in the pending-target set: identifies one armed
 * *incarnation* (key + startedAt), not just a row, so a process that
 * dies and a new one that reuses the same pid/port can never share a
 * pending guard. */
function pendingKeyFor(entry: PortEntry): string {
  return `${portKey(entry)}:${entry.startedAt}`;
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

  // The global keydown listener below is registered once (empty deps) so
  // it isn't re-attached on every render; it reads `entries`/selectedKey
  // through this ref instead of closing over them directly. Without
  // this, a keydown that lands in the same tick as a selection update
  // (e.g. the default-selection effect that fires right after the first
  // fetch resolves) could still be handled by a stale listener closure.
  const latest = useRef({ entries, selectedKey: nav.selectedKey });
  latest.current = { entries, selectedKey: nav.selectedKey };

  // Blocks a duplicate IPC call while `handleKill` is in flight for a
  // given armed incarnation — belt-and-suspenders alongside the hook's
  // own timer/key guards (e.g. a second confirming click firing before
  // the first `await killPort()` resolves). Removed in `finally`.
  const pendingKills = useRef<Set<string>>(new Set());

  async function handleKill(entry: PortEntry) {
    const pendingKey = pendingKeyFor(entry);
    if (pendingKills.current.has(pendingKey)) return;
    pendingKills.current.add(pendingKey);
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
    } finally {
      pendingKills.current.delete(pendingKey);
    }
  }

  // F6 Slice 2: one shared confirmation instance for both pointer and
  // keyboard kill requests — neither path can confirm without the other
  // seeing the same armed target, timer and invalidation.
  const confirm = useKillConfirm((entry) => {
    // Resolve the latest entry from the currently visible list and
    // re-validate right before executing: never act on a saved snapshot.
    const latestEntries = latest.current.entries;
    const current = latestEntries.find((e) => portKey(e) === portKey(entry));
    if (!current || !current.killable || current.startedAt !== entry.startedAt) return;
    void handleKill(current);
  });

  function requestKill(entry: PortEntry, source: "pointer" | "keyboard") {
    confirm.request(entry, source);
  }

  // Keyboard drives the list even while the search input owns focus.
  // Registered once; reads current entries/selection via `latest.current`
  // (see above) rather than depending on a re-attached closure.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.isComposing) return;

      // Enter/Space on a focused control (e.g. the kill/disclosure
      // button) must activate that control, not expand/navigate a row.
      const target = e.target;
      if (target instanceof HTMLButtonElement && (e.key === "Enter" || e.key === " ")) {
        return;
      }

      // Holding ⌘⌫ fires repeated keydown events; only the first press
      // should arm/confirm — otherwise a single hold could arm then
      // immediately confirm itself.
      if (e.key === "Backspace" && e.metaKey && e.repeat) {
        e.preventDefault();
        return;
      }

      const action = nav.onKeyDown(e);
      const { entries: currentEntries, selectedKey } = latest.current;
      const current = currentEntries.find((entry) => portKey(entry) === selectedKey);
      if (action === "expand" && current) {
        const k = portKey(current);
        setExpandedKey((prev) => (prev === k ? null : k));
      } else if (action === "kill" && current) {
        requestKill(current, "keyboard");
      } else if (action === "close") {
        void hidePanel();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Disarm the shared confirmation whenever its armed target stops being
  // valid: it scrolled out of the filtered list, its process incarnation
  // changed (pid/port reused), it became unkillable, its category
  // changed, or the row selection moved off of it.
  useEffect(() => {
    const armedTarget = confirm.armedTarget;
    if (!armedTarget) return;
    const current = entries.find((e) => portKey(e) === armedTarget.key);
    if (
      !current ||
      current.startedAt !== armedTarget.startedAt ||
      !current.killable ||
      portKey(current) !== nav.selectedKey
    ) {
      confirm.disarm();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, nav.selectedKey, confirm.armedTarget]);

  // A query change disarms any pending confirmation — the armed row may
  // no longer even be visible.
  useEffect(() => {
    confirm.disarm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // Losing window focus disarms the confirmation too (spec: window blur).
  useEffect(() => {
    function onBlur() {
      confirm.disarm();
    }
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Shell emits panel-shown on every open: instant refetch + focus.
  // (Async subscription disposal hardening is Slice 3's job — left as-is here.)
  useEffect(() => {
    if (!inTauri) return;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/event").then(async ({ listen }) => {
      unlisten = await listen("panel-shown", () => {
        confirm.disarm();
        void refetch();
        searchRef.current?.focus();
        searchRef.current?.select();
      });
    });
    return () => unlisten?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refetch]);

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
          armedKey={confirm.armedTarget?.key ?? null}
          onSelect={nav.setSelectedKey}
          onToggleExpand={(k) => setExpandedKey((prev) => (prev === k ? null : k))}
          onRequestKill={(entry) => requestKill(entry, "pointer")}
          onDisarmKill={confirm.disarm}
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
