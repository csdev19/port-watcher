import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePorts } from "@/hooks/use-ports";
import { useListNavigation } from "@/hooks/use-list-navigation";
import { useKillConfirm } from "@/hooks/use-kill-confirm";
import { useFavourites } from "@/hooks/use-favourites";
import { useSetting } from "@/settings/store";
import { filterPorts } from "@/lib/filter";
import { partitionPorts } from "@/lib/port-groups";
import { favouritesQueryHealth, filterFavouriteMatches, joinFavourites } from "@/lib/favourites";
import { inTauri, killPort, openSettings } from "@/lib/ports";
import { formatTemp } from "@/lib/thermal";
import { portKey, rowKey, type PortEntry, type RowScope } from "@/lib/types";
import { useThermalCurrent } from "@/hooks/use-thermal";
import { PortList } from "@/components/PortList";
import { FavouritesPanel } from "@/components/FavouritesPanel";
import { SearchInput } from "@/components/SearchInput";
import { EmptyState, ErrorState, FilteredEmptyState } from "@/components/PanelStates";
import { Toast, type ToastData } from "@/components/Toast";
import { Icon } from "@/components/Icon";
import { ThermalPanel } from "@/components/ThermalPanel";
import { MemoryPanel } from "@/components/MemoryPanel";
import { bandColor } from "@/components/ThermalChart";
import { UpdateBanner } from "@/components/UpdateBanner";
import { pendingVersion, useUpdate } from "@/lib/update";
import styles from "@/app.module.css";

type Tab = "ports" | "thermal" | "memory";
const TABS: Tab[] = ["ports", "thermal", "memory"];
const TAB_LABEL: Record<Tab, string> = { ports: "Ports", thermal: "Thermal", memory: "Memory" };

const FAVOURITES_LIST_ID = "port-list-favourites";

/** One keyboard-reachable row on the Ports tab. A port that is both a
 * favourite and listening yields two items with distinct keys. */
interface NavItem {
  key: string;
  scope: RowScope;
  entry: PortEntry;
}

function navItems(scope: RowScope, entries: PortEntry[]): NavItem[] {
  return entries.map((entry) => ({ key: rowKey(scope, entry), scope, entry }));
}

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
  const [showTemperature] = useSetting("showTemperatureInPanel");
  const [favouritesCollapsed, setFavouritesCollapsed] = useSetting("favouritesCollapsed");
  const [update, updateActions] = useUpdate();
  const [dismissedUpdate, setDismissedUpdate] = useSetting("dismissedUpdateVersion");
  // Settings > Ports > "Show apps & system": when off, app/system rows are
  // dropped from the listening list (list, counts, search, keyboard). The
  // Favourites section keeps the full snapshot: a watched port is watched
  // whichever process holds it.
  const [query, setQuery] = useState("");
  // A port opened from a Thermal peak stays visible even when its category
  // is hidden, for as long as the search still names it; otherwise the
  // jump would land on "No matches" for a port that is listening.
  const [linkedPort, setLinkedPort] = useState<number | null>(null);
  const shownPort = linkedPort !== null && query.trim() === String(linkedPort) ? linkedPort : null;
  const data = useMemo(
    () =>
      showAppsAndSystem
        ? allPorts
        : allPorts?.filter((e) => e.category === "dev" || e.port === shownPort),
    [allPorts, showAppsAndSystem, shownPort],
  );
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [manuallyExpanded, setManuallyExpanded] = useState(false);
  const [toast, setToast] = useState<ToastData | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("ports");
  // Bumped to focus (and select) the search after the render that shows it:
  // the field is hidden off the Ports tab, so focusing in the same handler
  // that switches to Ports would land on a hidden input.
  const [searchFocusRequest, setSearchFocusRequest] = useState(0);
  // Bumped on panel-shown: remounts the Favourites section so its local
  // watch-form/rename state resets with the rest of the panel.
  const [panelEpoch, setPanelEpoch] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});

  // F7 Slice 1-3: persisted watched ports, joined against the same live
  // `usePorts` snapshot the listening list uses — no second polling source.
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
  // on screen (search-filtered, saved order).
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
    () => favVisibleMatches.flatMap((m) => m.listeners),
    [favVisibleMatches],
  );
  // Kill actions on favourite rows are disabled while the snapshot is
  // stale (a background refetch failed and we're showing retained data)
  // — keyboard ⌘⌫ must respect the same guard as the row's disabled kill
  // button. Listening rows never carried this guard.
  const favKillDisabled = favHealth === "stale";

  // The Favourites section collapses like Apps & System, and the same
  // search rule applies: a nonempty query with favourite matches forces it
  // open. A query with no favourite match hides the section entirely (as
  // an empty Apps & System group is hidden), so no "no match" state stacks
  // above the listening list's own.
  const favSearching = query.trim() !== "";
  const favForcedOpen = favSearching && favVisibleMatches.length > 0;
  const favOpen = !favouritesCollapsed || favForcedOpen;
  const favSectionShown = !favSearching || favVisibleMatches.length > 0;

  // The Ports tab's rows as ONE keyboard list: the visible favourite
  // listener rows (when the section is open), then the visible listening
  // rows. Keys are scope-qualified (`rowKey`), so a port drawn in both
  // places is two rows — one highlight, and ↓ from the favourite copy
  // reaches the listening copy. Thermal has no rows. Both scopes route
  // through the same identity-based `useListNavigation`/`useKillConfirm`
  // plumbing; neither gets a parallel implementation.
  const listeningItems = useMemo(() => navItems("listening", visibleEntries), [visibleEntries]);
  const activeItems = useMemo(
    () =>
      activeTab !== "ports"
        ? []
        : favOpen
          ? [...navItems("favourites", favVisibleEntries), ...listeningItems]
          : listeningItems,
    [activeTab, favOpen, favVisibleEntries, listeningItems],
  );
  const activeKeys = useMemo(() => activeItems.map((item) => item.key), [activeItems]);
  const nav = useListNavigation(activeKeys);

  // The global keydown listener below is registered once (empty deps) so
  // it isn't re-attached on every render; it reads `items`/selectedKey
  // through this ref instead of closing over them directly. Without
  // this, a keydown that lands in the same tick as a selection update
  // (e.g. the default-selection effect that fires right after the first
  // fetch resolves) could still be handled by a stale listener closure.
  const latest = useRef({ items: activeItems, selectedKey: nav.selectedKey, favKillDisabled });
  latest.current = { items: activeItems, selectedKey: nav.selectedKey, favKillDisabled };

  // `useListNavigation` is called fresh every render, so `nav.onKeyDown`
  // is a *new* closure each time (it closes over that render's `keys`
  // and `selectedKey` via `move`'s useCallback deps). The keydown effect
  // below is registered once (empty deps) so it must never call `nav`
  // directly — that would freeze it on the first render's `onKeyDown`
  // (closing over `keys = []`), permanently breaking arrow-key
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
  // seeing the same armed target, timer and invalidation. Favourite and
  // listening rows share it; the armed key is the row key, so only the
  // copy acted on shows "Kill?".
  const confirm = useKillConfirm(
    (entry) => {
      // Resolve the latest entry from the currently visible list and
      // re-validate right before executing: never act on a saved snapshot.
      const current = latest.current.items.find(
        (item) => portKey(item.entry) === portKey(entry),
      )?.entry;
      if (!current || !current.killable || current.startedAt !== entry.startedAt) return;
      void handleKill(current);
    },
    { confirmBeforeKill },
  );

  function requestKill(entry: PortEntry, source: "pointer" | "keyboard", key: string) {
    confirm.request(entry, source, key);
  }

  // F7 Slice 3: toggling the star on a listening row. Saves `{ port }`
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
      const { items, selectedKey, favKillDisabled: staleFavourites } = latest.current;
      const current = items.find((item) => item.key === selectedKey);
      if (action === "expand" && current) {
        setExpandedKey((prev) => (prev === current.key ? null : current.key));
      } else if (
        action === "kill" &&
        current &&
        !(current.scope === "favourites" && staleFavourites)
      ) {
        requestKill(current.entry, "keyboard", current.key);
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
  // changed, the row selection moved off of it, or it is a favourite row
  // whose snapshot went stale.
  useEffect(() => {
    const armedTarget = confirm.armedTarget;
    if (!armedTarget) return;
    const current = activeItems.find((item) => item.key === armedTarget.key);
    if (
      !current ||
      current.entry.startedAt !== armedTarget.startedAt ||
      !current.entry.killable ||
      current.entry.category !== armedTarget.category ||
      current.key !== nav.selectedKey ||
      (current.scope === "favourites" && favKillDisabled)
    ) {
      confirm.disarm();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeItems, nav.selectedKey, confirm.armedTarget, favKillDisabled]);

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
  // entered after opening still overrides the collapsed default. The
  // Favourites section's collapsed state is a saved setting and survives.
  // Bumping `panelEpoch` remounts `FavouritesPanel`, which discards its own
  // local watch-form state — no second competing panel-shown listener is
  // needed for that.
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
        setActiveTab("ports");
        setManuallyExpanded(false);
        setQuery("");
        setExpandedKey(null);
        nav.setSelectedKey(null);
        confirm.disarm();
        setPanelEpoch((n) => n + 1);
        void refetch();
        setSearchFocusRequest((n) => n + 1);
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

  useEffect(() => {
    if (searchFocusRequest === 0) return;
    searchRef.current?.focus();
    searchRef.current?.select();
  }, [searchFocusRequest]);

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
      const secondaryKeys = new Set(navItems("listening", groups.secondary).map((i) => i.key));
      if (nav.selectedKey && secondaryKeys.has(nav.selectedKey)) nav.setSelectedKey(null);
      confirm.disarm();
    }
    setManuallyExpanded((prev) => !prev);
  }

  function toggleFavourites() {
    if (favForcedOpen) return;
    // Collapsing drops the favourite rows from navigation: a selection
    // inside them moves to the first listening row, and nothing stays armed.
    if (favOpen) {
      if (nav.selectedKey?.startsWith("favourites:")) {
        nav.setSelectedKey(listeningItems[0]?.key ?? null);
      }
      confirm.disarm();
    }
    setFavouritesCollapsed(!favouritesCollapsed);
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

  // A peak's port pill on the Thermal tab: back to Ports, filtered to it.
  function showPort(port: number) {
    switchTab("ports");
    setLinkedPort(port);
    setQuery(String(port));
    setSearchFocusRequest((n) => n + 1);
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
    activeTab !== "ports"
      ? ""
      : data
        ? `${filtered.length} ports · ${groups.dev.length} dev · updated ${updatedSecondsAgo}s ago${error ? " (update failed)" : ""}`
        : "loading…";

  return (
    <main className={styles.panel}>
      <UpdateBanner
        status={update}
        actions={updateActions}
        dismissedVersion={dismissedUpdate}
        onDismiss={setDismissedUpdate}
      />
      <div className={styles.tablist} role="tablist" aria-label="Panel" onKeyDown={onTabKeyDown}>
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
            {tab === "ports" ? (
              <span className={styles.tabCount}>{data ? data.length : "–"}</span>
            ) : tab === "thermal" && showTemperature ? (
              <TabTemperature />
            ) : null}
          </button>
        ))}
      </div>
      {/* Hidden, not unmounted, on Thermal: it keeps its autofocus-on-open
       * behaviour and the ref the panel-shown reset focuses. */}
      <div hidden={activeTab !== "ports"}>
        <SearchInput ref={searchRef} value={query} onChange={setQuery} />
      </div>

      {activeTab === "ports" ? (
        <div
          id="panel-ports"
          role="tabpanel"
          aria-labelledby="tab-ports"
          className={styles.tabPanel}
        >
          <div className={`${styles.list} ${styles.listStack}`}>
            {favSectionShown && (
              <section className={styles.section}>
                <button
                  type="button"
                  className={styles.disclosure}
                  aria-expanded={favOpen}
                  aria-controls={favOpen ? FAVOURITES_LIST_ID : undefined}
                  aria-label={
                    favForcedOpen ? "Favourites — expanded for search results" : undefined
                  }
                  disabled={favForcedOpen}
                  onClick={toggleFavourites}
                >
                  <Icon name="chevron-right" size={12} />
                  <span className={styles.disclosureLabel}>
                    FAVOURITES · {favSearching ? favVisibleMatches.length : favourites.items.length}
                  </span>
                </button>
                {favOpen && (
                  <div id={FAVOURITES_LIST_ID}>
                    <FavouritesPanel
                      key={panelEpoch}
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
                      onSelect={nav.setSelectedKey}
                      onToggleExpand={(k) => setExpandedKey((prev) => (prev === k ? null : k))}
                      onRequestKill={(entry) =>
                        requestKill(entry, "pointer", rowKey("favourites", entry))
                      }
                      onDisarmKill={confirm.disarm}
                    />
                  </div>
                )}
              </section>
            )}
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
                onRequestKill={(entry) => requestKill(entry, "pointer", rowKey("listening", entry))}
                onDisarmKill={confirm.disarm}
                onToggleSecondary={toggleSecondary}
                onToggleWatch={toggleWatch}
              />
            ) : favSearching ? (
              // Favourite matches already answer the search; the listening
              // list only says "no match" when nothing matched anywhere.
              favVisibleMatches.length === 0 && (
                <FilteredEmptyState query={query} onClear={() => setQuery("")} />
              )
            ) : (
              <EmptyState />
            )}
          </div>
        </div>
      ) : activeTab === "thermal" ? (
        <div
          id="panel-thermal"
          role="tabpanel"
          aria-labelledby="tab-thermal"
          className={styles.tabPanel}
        >
          <ThermalPanel onShowPort={showPort} />
        </div>
      ) : (
        <div
          id="panel-memory"
          role="tabpanel"
          aria-labelledby="tab-memory"
          className={styles.tabPanel}
        >
          <MemoryPanel
            onShowPort={showPort}
            onNotify={(message) => setToast({ message, command: null })}
          />
        </div>
      )}

      <footer className={styles.footer}>
        {activeTab === "thermal" || activeTab === "memory" ? (
          // One footer strip: the tab's link takes the text slot.
          <button
            type="button"
            className={styles.footerLink}
            onClick={() => void openSettings(activeTab)}
          >
            {activeTab === "thermal" ? "Thermal history in Settings" : "Memory history in Settings"}
          </button>
        ) : (
          <span>{footerText}</span>
        )}
        <button
          type="button"
          className={styles.footerButton}
          aria-label={
            pendingVersion(update)
              ? `Settings (chapay ${pendingVersion(update)} is available)`
              : "Settings"
          }
          title="Settings (⌘,)"
          onClick={() => void openSettings()}
        >
          <Icon name="settings" />
          {pendingVersion(update) ? (
            <span className={styles.updateDot} data-testid="update-dot" aria-hidden />
          ) : null}
        </button>
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

/** The Thermal tab's `58°`, coloured by band. Mounted only while the
 * setting is on, so with it off the Ports tab polls no thermal command. */
function TabTemperature() {
  const { data } = useThermalCurrent();
  if (!data) return null;
  return (
    <span className={styles.tabTemp} style={{ color: bandColor(data.band) }}>
      {formatTemp(data.avgC)}
    </span>
  );
}
