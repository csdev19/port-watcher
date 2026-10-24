import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePorts } from "@/hooks/use-ports";
import { useListNavigation } from "@/hooks/use-list-navigation";
import { useKillConfirm } from "@/hooks/use-kill-confirm";
import { useFavourites } from "@/hooks/use-favourites";
import { useMachine } from "@/hooks/use-machine";
import { useSetting } from "@/settings/store";
import { filterPorts } from "@/lib/filter";
import { partitionPorts } from "@/lib/port-groups";
import {
  favouritesFooterText,
  favouritesQueryHealth,
  filterFavouriteMatches,
  joinFavourites,
} from "@/lib/favourites";
import { inTauri, killPort, openSettings, quitApp } from "@/lib/ports";
import { portKey, type PortEntry } from "@/lib/types";
import { PortList } from "@/components/PortList";
import { FavouritesPanel } from "@/components/FavouritesPanel";
import { SearchInput } from "@/components/SearchInput";
import { EmptyState, ErrorState, FilteredEmptyState } from "@/components/PanelStates";
import { Toast, type ToastData } from "@/components/Toast";
import { PanelFooter } from "@/components/PanelFooter";
import { Tabs } from "@/components/Tabs";
import { PanelHeader } from "@/components/PanelHeader";
import { UpdateBanner } from "@/components/UpdateBanner";
import { MachineView } from "@/components/MachineView";
import { pendingVersion, useUpdate } from "@/lib/update";
import styles from "@/app.module.css";

type Tab = "listening" | "favourites";
type TopTab = "ports" | "machine";

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
  const { data: allPorts, error, refetch, dataUpdatedAt } = usePorts();
  const [confirmBeforeKill] = useSetting("confirmBeforeKill");
  const [showAppsAndSystem] = useSetting("showAppsAndSystem");
  const [update, updateActions] = useUpdate();
  const [dismissedUpdate, setDismissedUpdate] = useSetting("dismissedUpdateVersion");
  // Settings > Ports > "Show apps & system": when off, app/system rows are
  // dropped from the Listening tab (list, counts, search, keyboard). The
  // Favourites tab keeps the full snapshot: a watched port is watched
  // whichever process holds it.
  const data = useMemo(
    () => (showAppsAndSystem ? allPorts : allPorts?.filter((e) => e.category === "dev")),
    [allPorts, showAppsAndSystem],
  );
  const [query, setQuery] = useState("");
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [manuallyExpanded, setManuallyExpanded] = useState(false);
  // Key of the row whose confirmed kill is in flight; drives the row veil.
  const [killingKey, setKillingKey] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastData | null>(null);
  // Multi-listener Favourites watches whose per-listener rows are open.
  const [expandedWatches, setExpandedWatches] = useState<ReadonlySet<number>>(new Set());
  const [activeTab, setActiveTab] = useState<Tab>("listening");
  const searchRef = useRef<HTMLInputElement>(null);
  // Top-level tabs. Machine samples at 1 Hz only while it is the active tab and the panel is
  // visible; the Ports state below stays mounted, so nothing there changes.
  const [topTab, setTopTab] = useState<TopTab>("ports");
  const topTabRef = useRef<TopTab>(topTab);
  topTabRef.current = topTab;
  const machine = useMachine(topTab === "machine");
  const focusSearchOnMount = useRef(false);
  useEffect(() => {
    if (topTab === "ports" && focusSearchOnMount.current && searchRef.current) {
      focusSearchOnMount.current = false;
      searchRef.current.focus();
      searchRef.current.select();
    }
  }, [topTab]);

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
  const allSecondaryCount = useMemo(() => partitionPorts(data ?? []).secondary.length, [data]);
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
    () => joinFavourites(favourites.items, allPorts ?? []),
    [favourites.items, allPorts],
  );
  const favHealth = favouritesQueryHealth(allPorts, error);
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
    () =>
      favVisibleMatches.flatMap((m) =>
        // A multi-listener watch shows its listener rows only while open.
        m.listeners.length > 1 && !expandedWatches.has(m.favourite.port) ? [] : m.listeners,
      ),
    [favVisibleMatches, expandedWatches],
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
    setKillingKey(portKey(entry));
    try {
      const result = await killPort(entry);
      if (result === "terminated" || result === "killed") {
        setToast({
          message: `${entry.label} (${entry.port}) stopped`,
          command: entry.command,
        });
        queryClient.invalidateQueries({ queryKey: ["ports"] });
      } else if (result === "alreadyGone") {
        setToast({
          message: `${entry.label} (${entry.port}) was already gone`,
          command: null,
        });
        queryClient.invalidateQueries({ queryKey: ["ports"] });
      } else {
        setToast({
          message: `Cannot kill ${entry.label} (${entry.port})`,
          command: null,
        });
      }
    } catch (err) {
      setToast({
        message: `Could not kill ${entry.label} (${entry.port}): ${String(err)}`,
        command: null,
      });
    } finally {
      pendingKills.current.delete(pendingKey);
      setKillingKey((prev) => (prev === portKey(entry) ? null : prev));
    }
  }

  // F6 Slice 2: one shared confirmation instance for both pointer and
  // keyboard kill requests — neither path can confirm without the other
  // seeing the same armed target, timer and invalidation. F7 Slice 3
  // reuses this same instance for Favourites' listener rows (Slice 4
  // extends it to a Favourites-aware visible-entries array).
  const confirm = useKillConfirm(
    (entry) => {
      // Resolve the latest entry from the currently visible list and
      // re-validate right before executing: never act on a saved snapshot.
      const latestEntries = latest.current.entries;
      const current = latestEntries.find((e) => portKey(e) === portKey(entry));
      if (!current || !current.killable || current.startedAt !== entry.startedAt) return;
      void handleKill(current);
    },
    { confirmBeforeKill },
  );

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

      // ⌘, opens Settings, as in every Mac app.
      if (e.key === "," && e.metaKey) {
        e.preventDefault();
        void openSettings();
        return;
      }

      // ⌘1 / ⌘2 switch the top-level tabs from anywhere in the panel.
      if (e.metaKey && (e.key === "1" || e.key === "2")) {
        e.preventDefault();
        switchTopTab(e.key === "1" ? "ports" : "machine");
        return;
      }

      // On the Machine tab the port list is not on screen: its arrows, Enter and ⌘⌫ must not
      // touch ports. The process list owns ↑/↓/⌘⌫ itself; Esc still hides the panel.
      if (topTabRef.current === "machine") {
        if (e.key === "Escape") void hidePanel();
        return;
      }

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

      // ⌘⌫ in the search box is the macOS "delete to line start" shortcut:
      // let it clear the field instead of killing the selected row.
      if (e.key === "Backspace" && e.metaKey && target === searchRef.current) {
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
        // Always open on Ports: shortcut-then-type-to-search stays the default habit.
        setTopTab("ports");
        setActiveTab("listening");
        setManuallyExpanded(false);
        setExpandedWatches(new Set());
        setQuery("");
        setExpandedKey(null);
        nav.setSelectedKey(null);
        confirm.disarm();
        void refetch();
        // The search box is not mounted while Machine is showing; focus it once Ports is back.
        if (searchRef.current) {
          searchRef.current.focus();
          searchRef.current.select();
        } else {
          focusSearchOnMount.current = true;
        }
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

  function toggleWatchGroup(port: number) {
    setExpandedWatches((prev) => {
      const next = new Set(prev);
      if (!next.delete(port)) next.add(port);
      return next;
    });
  }

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
    setExpandedWatches(new Set());
    setQuery("");
    setExpandedKey(null);
    nav.setSelectedKey(null);
    confirm.disarm();
  }

  // Switching top tabs drops any armed port kill and its keyboard selection, so a hidden
  // list can never be confirmed from the other tab.
  function switchTopTab(next: TopTab) {
    if (next === topTabRef.current) return;
    confirm.disarm();
    setTopTab(next);
  }

  const portsFooterText =
    activeTab === "listening"
      ? data
        ? `${groups.dev.length} dev · ${updatedSecondsAgo}s${error ? " · update failed" : ""}`
        : "loading…"
      : favouritesFooterText(favourites.items.length, favMatches, favHealth);
  const footerText =
    topTab === "machine"
      ? machine.data
        ? `${machine.data.machine.chip} · ${machine.data.machine.cores} cores · ${
            machine.data.intervalMs / 1000
          }s`
        : "reading machine…"
      : portsFooterText;

  return (
    <main className={styles.panel}>
      <PanelHeader
        count={allPorts?.length ?? 0}
        verdict={topTab === "machine" ? (machine.data?.verdict ?? null) : null}
      />
      <UpdateBanner
        status={update}
        actions={updateActions}
        dismissedVersion={dismissedUpdate}
        onDismiss={setDismissedUpdate}
      />
      <Tabs
        ariaLabel="Panel"
        active={topTab}
        onChange={switchTopTab}
        tabs={[
          {
            id: "ports",
            label: "Ports",
            count: allPorts ? allPorts.length : "–",
          },
          { id: "machine", label: "Machine", count: "" },
        ]}
      />

      {topTab === "machine" ? (
        <div
          id="panel-machine"
          role="tabpanel"
          aria-labelledby="tab-machine"
          className={styles.tabPanel}
        >
          <MachineView snapshot={machine.data} error={machine.error} onToast={setToast} />
        </div>
      ) : (
        <div
          id="panel-ports"
          role="tabpanel"
          aria-labelledby="tab-ports"
          className={styles.tabPanel}
        >
          <SearchInput ref={searchRef} value={query} onChange={setQuery} />
          <Tabs
            ariaLabel="Ports"
            active={activeTab}
            onChange={switchTab}
            tabs={[
              {
                id: "listening",
                label: "Listening",
                count: data ? data.length : "–",
              },
              {
                id: "favourites",
                label: "Favourites",
                count: favourites.items.length,
              },
            ]}
          />

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
                  secondaryTotal={allSecondaryCount}
                  searching={query.trim() !== ""}
                  secondaryOpen={secondaryOpen}
                  secondaryForcedOpen={forcedOpen}
                  selectedKey={nav.selectedKey}
                  expandedKey={expandedKey}
                  armedKey={confirm.armedTarget?.key ?? null}
                  killingKey={killingKey}
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
                rename={favourites.rename}
                data={allPorts}
                queryError={error}
                query={query}
                onClearQuery={() => setQuery("")}
                onRetry={() => void refetch()}
                selectedKey={nav.selectedKey}
                expandedKey={expandedKey}
                armedKey={confirm.armedTarget?.key ?? null}
                killingKey={killingKey}
                expandedWatches={expandedWatches}
                onToggleWatchGroup={toggleWatchGroup}
                onSelect={nav.setSelectedKey}
                onToggleExpand={(k) => setExpandedKey((prev) => (prev === k ? null : k))}
                onRequestKill={(entry) => requestKill(entry, "pointer")}
                onDisarmKill={confirm.disarm}
              />
            </div>
          )}
        </div>
      )}

      <PanelFooter
        status={footerText}
        pendingUpdateVersion={pendingVersion(update)}
        onOpenSettings={() => void openSettings()}
        onQuit={() => void quitApp()}
      />
      {toast && (
        <Toast
          toast={toast}
          onCopy={() => {
            if (toast.command) {
              navigator.clipboard.writeText(toast.command).catch(() =>
                setToast({
                  message: "Could not copy command",
                  command: null,
                }),
              );
            }
            setToast(null);
          }}
        />
      )}
    </main>
  );
}
