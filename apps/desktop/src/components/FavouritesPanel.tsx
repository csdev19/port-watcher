import { useEffect, useMemo, useRef, useState } from "react";
import {
  favouritesQueryHealth,
  filterFavouriteMatches,
  joinFavourites,
  type FavouriteMatch,
  type FavouritePort,
  type MutationResult,
} from "@/lib/favourites";
import { portKey, type PortEntry } from "@/lib/types";
import { PortRow } from "@/components/PortRow";
import { WatchPortForm } from "@/components/WatchPortForm";
import { Icon } from "@/components/Icon";
import styles from "@/app.module.css";

interface Props {
  favourites: FavouritePort[];
  favouritesError: string | null;
  onClearFavouritesError: () => void;
  add: (portInput: string, nameInput?: string) => MutationResult;
  remove: (port: number) => MutationResult;
  rename: (port: number, nameInput: string) => MutationResult;
  /** Raw (unfiltered by the main search) `usePorts` snapshot and query
   * health signals — this component never calls `listPorts`, starts a
   * timer, or calls `killPort` itself; App owns all of that. */
  data: PortEntry[] | undefined;
  queryError: unknown;
  query: string;
  onClearQuery: () => void;
  onRetry: () => void;
  selectedKey: string | null;
  expandedKey: string | null;
  armedKey: string | null;
  onSelect: (key: string) => void;
  onToggleExpand: (key: string) => void;
  onRequestKill: (entry: PortEntry) => void;
  onDisarmKill: () => void;
}

/** F7 Slice 3: Favourites tab. Renders one flat list of watch groups (no
 * app/system disclosure — unlike Listening, everything here was
 * deliberately saved by the user), each with a heading (saved name/port,
 * live status, remove action) and its live listener rows underneath,
 * reusing F6's `PortRow` — not a second kill UI. */
export function FavouritesPanel({
  favourites,
  favouritesError,
  onClearFavouritesError,
  add,
  remove,
  rename,
  data,
  queryError,
  query,
  onClearQuery,
  onRetry,
  selectedKey,
  expandedKey,
  armedKey,
  onSelect,
  onToggleExpand,
  onRequestKill,
  onDisarmKill,
}: Props) {
  const [formOpen, setFormOpen] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [editingPort, setEditingPort] = useState<number | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const health = favouritesQueryHealth(data, queryError);
  // Pure joins/filters only. `matches` (unfiltered by search) drives the
  // footer's totals in App; `visibleMatches` drives what's on screen here.
  const matches = useMemo(() => joinFavourites(favourites, data ?? []), [favourites, data]);
  const visibleMatches = useMemo(() => filterFavouriteMatches(matches, query), [matches, query]);

  function openForm() {
    setMutationError(null);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    triggerRef.current?.focus();
  }

  function handleAddSuccess() {
    setFormOpen(false);
    // A newly added watch might be hidden by an active search — clearing
    // it guarantees the watch the user just added is visible.
    if (query.trim() !== "") onClearQuery();
    triggerRef.current?.focus();
  }

  function handleRemove(port: number) {
    const result = remove(port);
    setMutationError(result.ok ? null : result.message);
  }

  function handleRenameSubmit(port: number, nameInput: string) {
    const result = rename(port, nameInput);
    if (!result.ok) {
      setMutationError(result.message);
      return;
    }
    setMutationError(null);
    setEditingPort(null);
  }

  const stale = health === "stale";

  return (
    <div className={styles.list}>
      {favouritesError && (
        <p className={styles.watchError} role="alert">
          {favouritesError}{" "}
          <button type="button" className={styles.watchFormCancel} onClick={onClearFavouritesError}>
            Dismiss
          </button>
        </p>
      )}
      {mutationError && (
        <p className={styles.watchError} role="alert">
          {mutationError}
        </p>
      )}
      {health === "unavailable" && (
        <p className={styles.watchError} role="alert">
          Status unavailable.{" "}
          <button type="button" className={styles.watchFormCancel} onClick={onRetry}>
            Retry
          </button>
        </p>
      )}

      {favourites.length === 0 ? (
        <div className={styles.state}>
          <Icon name="star" size={24} />
          <p className={styles.stateTitle}>No watched ports yet</p>
          {formOpen ? (
            <WatchPortForm add={add} onSuccess={handleAddSuccess} onCancel={closeForm} />
          ) : (
            <button
              type="button"
              ref={triggerRef}
              className={styles.stateButton}
              onClick={openForm}
            >
              <Icon name="plus" />
              Watch a port
            </button>
          )}
        </div>
      ) : visibleMatches.length === 0 ? (
        <div className={styles.state}>
          <Icon name="search-x" size={24} />
          <p className={styles.stateTitle}>No watches match {query}</p>
          <button type="button" className={styles.stateButton} onClick={onClearQuery}>
            <Icon name="x" />
            Clear search
          </button>
        </div>
      ) : (
        <>
          {visibleMatches.map(({ favourite, listeners }) => {
            const statusLabel =
              health === "checking"
                ? "checking…"
                : health === "unavailable"
                  ? "status unavailable"
                  : listeners.length > 0
                    ? stale
                      ? "in use · stale"
                      : "in use"
                    : stale
                      ? "nothing listening · stale"
                      : "nothing listening";
            const statusClass =
              health === "fresh" && listeners.length === 0
                ? styles.watchStatusFree
                : stale
                  ? styles.watchStatusStale
                  : styles.watchStatus;

            return (
              <div className={styles.watchGroup} key={favourite.port}>
                <div className={styles.watchHeading}>
                  {editingPort === favourite.port ? (
                    <WatchNameField
                      port={favourite.port}
                      initialValue={favourite.name ?? liveProcessName(listeners) ?? ""}
                      onSubmit={handleRenameSubmit}
                      onCancel={() => setEditingPort(null)}
                    />
                  ) : (
                    <button
                      type="button"
                      className={styles.watchHeadingLabel}
                      onClick={() => setEditingPort(favourite.port)}
                      aria-label={`Rename watched port ${favourite.port}`}
                    >
                      <span className={styles.watchHeadingLabelText}>
                        {(favourite.name ?? liveProcessName(listeners))
                          ? `${favourite.name ?? liveProcessName(listeners)} · `
                          : ""}
                      </span>
                      <span className={styles.watchHeadingPort}>{favourite.port}</span>
                      <span className={styles.watchHeadingPencil}>
                        <Icon name="pencil" size={12} />
                      </span>
                    </button>
                  )}
                  <span className={statusClass}>{statusLabel}</span>
                  <button
                    type="button"
                    className={styles.watchRemove}
                    aria-label={`Remove watched port ${favourite.port}`}
                    onClick={() => handleRemove(favourite.port)}
                  >
                    <Icon name="trash-2" />
                  </button>
                </div>
                {listeners.length > 0 && (
                  <ul
                    className={styles.rowList}
                    role="listbox"
                    aria-label={`Listeners on port ${favourite.port}`}
                  >
                    {listeners.map((entry) => {
                      const k = portKey(entry);
                      return (
                        <PortRow
                          key={k}
                          entry={entry}
                          selected={k === selectedKey}
                          expanded={expandedKey === k}
                          armed={armedKey === k}
                          killDisabled={stale}
                          onSelect={() => onSelect(k)}
                          onToggleExpand={() => onToggleExpand(k)}
                          onRequestKill={() => onRequestKill(entry)}
                          onDisarm={onDisarmKill}
                        />
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
          {formOpen ? (
            <WatchPortForm add={add} onSuccess={handleAddSuccess} onCancel={closeForm} />
          ) : (
            <button
              type="button"
              ref={triggerRef}
              className={styles.watchFormTrigger}
              onClick={openForm}
            >
              <Icon name="plus" />
              Watch a port
            </button>
          )}
        </>
      )}
    </div>
  );
}

function liveProcessName(listeners: FavouriteMatch["listeners"]): string | undefined {
  return listeners[0]?.processName;
}

interface WatchNameFieldProps {
  port: number;
  initialValue: string;
  onSubmit: (port: number, nameInput: string) => void;
  onCancel: () => void;
}

/** Inline rename field for a Favourites heading — never a dialog. Enter
 * saves, Escape cancels, blur saves (matches click-to-rename UX). */
function WatchNameField({ port, initialValue, onSubmit, onCancel }: WatchNameFieldProps) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onCancel();
    } else if (e.key === "Enter") {
      e.preventDefault();
      onSubmit(port, value);
    }
  }

  return (
    <input
      ref={inputRef}
      type="text"
      className={styles.watchHeadingRenameInput}
      value={value}
      maxLength={30}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      data-list-shortcuts="off"
      aria-label={`Rename watched port ${port}`}
      onChange={(e) => setValue(e.currentTarget.value)}
      onKeyDown={handleKeyDown}
      onBlur={() => onSubmit(port, value)}
    />
  );
}
