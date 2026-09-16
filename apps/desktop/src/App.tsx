import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePorts } from "@/hooks/use-ports";
import { useListNavigation } from "@/hooks/use-list-navigation";
import { useKillConfirm } from "@/hooks/use-kill-confirm";
import { useFavourites } from "@/hooks/use-favourites";
import { filterPorts } from "@/lib/filter";
import { partitionPorts } from "@/lib/port-groups";
import {
  favouritesFooterText,
  favouritesQueryHealth,
  filterFavouriteMatches,
  joinFavourites,
} from "@/lib/favourites";
import { inTauri, killPort } from "@/lib/ports";
import { portKey, type PortEntry } from "@/lib/types";
import { PortList } from "@/components/PortList";
import { FavouritesPanel } from "@/components/FavouritesPanel";
import { SearchInput } from "@/components/SearchInput";
import { EmptyState, ErrorState, FilteredEmptyState } from "@/components/PanelStates";
import { Toast, type ToastData } from "@/components/Toast";
import styles from "@/app.module.css";

type Tab = "listening" | "favourites";
const TABS: Tab[] = ["listening", "favourites"];
const TAB_LABEL: Record<Tab, string> = { listening: "Listening", favourites: "Favourites" };

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
  const [manuallyExpanded, setManuallyExpanded] = useState(false);
  const [toast, setToast] = useState<ToastData | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("listening");
  const searchRef = useRef<HTMLInputElement>(null);
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});

  // F7 Slice 1-3: persisted watched ports, joined against the same live
  // `usePorts` snapshot both tabs share — no second polling source.
  const favourites = useFavourites();
  const favouritePorts = useMemo(
    () => new Set(favourites.items.map((f) => f.port)),
    [favourites.items],
  );

  // F6 Slice 3: filter first, then partition into the dev/secondary
  // (app+system) groups the panel renders. Secondary is collapsed by
  // default; a nonempty query with secondary matches forces it open so
  // search can never hide a match behind a closed disclosure.
  const filtered = useMemo(() => filterPorts(data ?? [], query), [data, query]);
  const groups = useMemo(() => partitionPorts(filtered), [filtered]);
  const forcedOpen = query.trim() !== "" && groups.secondary.length > 0;
  const secondaryOpen = manuallyExpanded || forcedOpen;
  // Only the rows actually on screen are keyboard-reachable — a row
  // hidden behind a collapsed disclosure can never be selected or killed.
  const visibleEntries = useMemo(
    () => (secondaryOpen ? [...groups.dev, ...groups.secondary] : groups.dev),
    [groups, secondaryOpen],
  );

  // F7 Slice 2/4: the same join/health helpers Favourites renders from,
  // lifted here so the shared navigation/kill plumbing below can see them
  // too. `favVisibleMatches` mirrors exactly what `FavouritesPanel` puts
  // on screen (search-filtered, saved order) — never the raw, unfiltered
  // `favMatches` used for footer/tab-count totals.
  const favMatches = useMemo(
    () => joinFavourites(favourites.items, data ?? []),
    [favourites.items, data],
  );
  const favHealth = favouritesQueryHealth(data, error);
  const favVisibleMatches = useMemo(
    () => filterFavouriteMatches(favMatches, query),
    [favMatches, query],
  );
  // F7 Slice 4: flatten only the *currently visible* watches' listener
  // arrays, in render order (saved order, then each watch's listeners in
  // snapshot order) — free/unknown watches (`listeners: []`) contribute
  // nothing here, so they can never become a keyboard-selectable or
  // killable target; only real listener rows are navigable.
  const favVisibleEntries = useMemo(
    () => favVisibleMatches.flatMap((m) => m.listeners),
    [favVisibleMatches],
  );
  // Kill actions are disabled while the snapshot backing Favourites is
  // stale (a background refetch failed and we're showing retained data)
  // — keyboard ⌘⌫ must respect the same guard as the row's disabled
  // kill button.
  const favKillDisabled = favHealth === "stale";

  // F7 Slice 4: the active tab decides which live entries are
  // keyboard-navigable/killable — Listening's grouped rows, or
  // Favourites' currently visible listener rows. Both route through the
  // same identity-based `useListNavigation`/`useKillConfirm` plumbing;
  // neither tab gets a parallel implementation.
  const activeEntries = activeTab === "favourites" ? favVisibleEntries : visibleEntries;
  const nav = useListNavigation(activeEntries);

  // The global keydown listener below is registered once (empty deps) so
  // it isn't re-attached on every render; it reads `entries`/selectedKey
  // through this ref instead of closing over them directly. Without
  // this, a keydown that lands in the same tick as a selection update
  // (e.g. the default-selection effect that fires right after the first
  // fetch resolves) could still be handled by a stale listener closure.
  const latest = useRef({
    entries: activeEntries,
    selectedKey: nav.selectedKey,
    killDisabled: activeTab === "favourites" && favKillDisabled,
  });
  latest.current = {
    entries: activeEntries,
    selectedKey: nav.selectedKey,
    killDisabled: activeTab === "favourites" && favKillDisabled,
  };

  // `useListNavigation` is called fresh every render, so `nav.onKeyDown`
  // is a *new* closure each time (it closes over that render's `entries`
  // and `selectedKey` via `move`'s useCallback deps). The keydown effect
  // below is registered once (empty deps) so it must never call `nav`
  // directly — that would freeze it on the first render's `onKeyDown`
  // (closing over `entries = []`), permanently breaking arrow-key
  // movement. Route through this ref, updated every render, instead.
  const navRef = useRef(nav);
  navRef.current = nav;

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
  // seeing the same armed target, timer and invalidation. F7 Slice 3
  // reuses this same instance for Favourites' listener rows (Slice 4
  // extends it to a Favourites-aware visible-entries array).
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

  // F7 Slice 3: toggling the star on a Listening row. Saves `{ port }`
  // only — no process label baked in, since labels change as processes
  // restart. Failure surfaces through the existing toast rather than a
  // second error UI.
  function toggleWatch(entry: PortEntry) {
    const result = favouritePorts.has(entry.port)
      ? favourites.remove(entry.port)
      : favourites.add(String(entry.port));
    if (!result.ok) {
      setToast({ message: result.message, command: null });
    }
  }

  // Keyboard drives the list even while the search input owns focus.
  // Registered once; reads current entries/selection via `latest.current`
  // (see above) rather than depending on a re-attached closure.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.isComposing) return;

      // F7 Slice 3: the inline watch form is an excluded keyboard scope —
      // arrows/⌘⌫ edit its fields, never navigate or kill a row.
      const target = e.target;
      if (target instanceof HTMLElement && target.closest('[data-list-shortcuts="off"]')) {
        return;
      }

      // Enter/Space on a focused control (e.g. the kill/disclosure
      // button) must activate that control, not expand/navigate a row.
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

      const action = navRef.current.onKeyDown(e);
      const { entries: currentEntries, selectedKey, killDisabled } = latest.current;
      const current = currentEntries.find((entry) => portKey(entry) === selectedKey);
      if (action === "expand" && current) {
        const k = portKey(current);
        setExpandedKey((prev) => (prev === k ? null : k));
      } else if (action === "kill" && current && !killDisabled) {
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
    const current = activeEntries.find((e) => portKey(e) === armedTarget.key);
    if (
      !current ||
      current.startedAt !== armedTarget.startedAt ||
      !current.killable ||
      current.category !== armedTarget.category ||
      portKey(current) !== nav.selectedKey ||
      (activeTab === "favourites" && favKillDisabled)
    ) {
      confirm.disarm();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEntries, nav.selectedKey, confirm.armedTarget, activeTab, favKillDisabled]);

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

  // Shell emits panel-shown on every open: reset all ephemeral panel state
  // to the same defaults the initial mount uses (manual expansion, query,
  // detail key, selection, confirmation and active tab), then refetch and
  // focus main search. Clearing the query on open is deliberate — search
  // entered after opening still overrides the collapsed default. Resetting
  // to the Listening tab also unmounts `FavouritesPanel`, which discards
  // its own local watch-form state — no second competing panel-shown
  // listener is needed for that.
  //
  // `listen()` resolves asynchronously, so a `disposed` flag guards
  // against the effect's cleanup running (unmount, or a second run under
  // StrictMode) before that promise settles: if disposal already
  // happened by the time `listen` resolves, unlisten immediately instead
  // of storing a handler nobody will ever clean up.
  useEffect(() => {
    if (!inTauri) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/event").then(async ({ listen }) => {
      const stop = await listen("panel-shown", () => {
        setActiveTab("listening");
        setManuallyExpanded(false);
        setQuery("");
        setExpandedKey(null);
        nav.setSelectedKey(null);
        confirm.disarm();
        void refetch();
        searchRef.current?.focus();
        searchRef.current?.select();
      });
      if (disposed) {
        stop();
        return;
      }
      unlisten = stop;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  function toggleSecondary() {
    if (forcedOpen) return;
    // A collapse must never leave a now-hidden row selected/armed.
    if (manuallyExpanded) {
      const stillVisibleKey =
        nav.selectedKey && groups.dev.some((e) => portKey(e) === nav.selectedKey);
      if (!stillVisibleKey) nav.setSelectedKey(null);
      confirm.disarm();
    }
    setManuallyExpanded((prev) => !prev);
  }

  // F7 Slice 3: switching tabs clears query/detail-expansion/selection/
  // confirmation — the same reset panel-shown performs, minus the tab
  // itself (which is exactly what's changing).
  function switchTab(next: Tab) {
    if (next === activeTab) return;
    setActiveTab(next);
    setQuery("");
    setExpandedKey(null);
    nav.setSelectedKey(null);
    confirm.disarm();
  }

  // Left/Right move and activate; Home/End jump to first/last. Stops
  // propagation so these never fall through to list navigation.
  function onTabKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const idx = TABS.indexOf(activeTab);
    let nextIdx: number | null = null;
    if (e.key === "ArrowRight") nextIdx = (idx + 1) % TABS.length;
    else if (e.key === "ArrowLeft") nextIdx = (idx - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") nextIdx = 0;
    else if (e.key === "End") nextIdx = TABS.length - 1;

    if (nextIdx === null) return;
    e.preventDefault();
    e.stopPropagation();
    const next = TABS[nextIdx];
    switchTab(next);
    tabRefs.current[next]?.focus();
  }

  const footerText =
    activeTab === "listening"
      ? data
        ? `${filtered.length} ports · ${groups.dev.length} dev · updated ${updatedSecondsAgo}s ago${error ? " (update failed)" : ""}`
        : "loading…"
      : favouritesFooterText(favourites.items.length, favMatches, favHealth);

  return (
    <main className={styles.panel}>
      <SearchInput ref={searchRef} value={query} onChange={setQuery} />
      <div className={styles.tablist} role="tablist" aria-label="Ports" onKeyDown={onTabKeyDown}>
        {TABS.map((tab) => (
          <button
            key={tab}
            ref={(el) => {
              tabRefs.current[tab] = el;
            }}
            type="button"
            role="tab"
            id={`tab-${tab}`}
            aria-selected={activeTab === tab}
            aria-controls={`panel-${tab}`}
            tabIndex={activeTab === tab ? 0 : -1}
            className={activeTab === tab ? `${styles.tab} ${styles.tabActive}` : styles.tab}
            onClick={() => switchTab(tab)}
          >
            {TAB_LABEL[tab]}
            <span className={styles.tabCount}>
              {tab === "listening" ? (data ? data.length : "–") : favourites.items.length}
            </span>
          </button>
        ))}
      </div>

      {activeTab === "listening" ? (
        <div
          id="panel-listening"
          role="tabpanel"
          aria-labelledby="tab-listening"
          className={styles.tabPanel}
        >
          {error && !data ? (
            <ErrorState message={String(error)} onRetry={() => void refetch()} />
          ) : filtered.length > 0 ? (
            <PortList
              groups={groups}
              secondaryOpen={secondaryOpen}
              secondaryForcedOpen={forcedOpen}
              selectedKey={nav.selectedKey}
              expandedKey={expandedKey}
              armedKey={confirm.armedTarget?.key ?? null}
              favouritePorts={favouritePorts}
              onSelect={nav.setSelectedKey}
              onToggleExpand={(k) => setExpandedKey((prev) => (prev === k ? null : k))}
              onRequestKill={(entry) => requestKill(entry, "pointer")}
              onDisarmKill={confirm.disarm}
              onToggleSecondary={toggleSecondary}
              onToggleWatch={toggleWatch}
            />
          ) : query.trim() !== "" ? (
            <FilteredEmptyState query={query} onClear={() => setQuery("")} />
          ) : (
            <EmptyState />
          )}
        </div>
      ) : (
        <div
          id="panel-favourites"
          role="tabpanel"
          aria-labelledby="tab-favourites"
          className={styles.tabPanel}
        >
          <FavouritesPanel
            favourites={favourites.items}
            favouritesError={favourites.error}
            onClearFavouritesError={favourites.clearError}
            add={favourites.add}
            remove={favourites.remove}
            data={data}
            queryError={error}
            query={query}
            onClearQuery={() => setQuery("")}
            onRetry={() => void refetch()}
            selectedKey={nav.selectedKey}
            expandedKey={expandedKey}
            armedKey={confirm.armedTarget?.key ?? null}
            onSelect={nav.setSelectedKey}
            onToggleExpand={(k) => setExpandedKey((prev) => (prev === k ? null : k))}
            onRequestKill={(entry) => requestKill(entry, "pointer")}
            onDisarmKill={confirm.disarm}
          />
        </div>
      )}

      <footer className={styles.footer}>{footerText}</footer>
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
