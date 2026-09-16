import { useMemo, useRef, useState } from "react";
import {
  favouritesQueryHealth,
  filterFavouriteMatches,
  joinFavourites,
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
                  <span className={styles.watchHeadingLabel}>
                    {favourite.name && `${favourite.name} · `}
                    <span className={styles.watchHeadingPort}>{favourite.port}</span>
                  </span>
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
