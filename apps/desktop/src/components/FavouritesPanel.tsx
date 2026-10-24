import { Fragment, useEffect, useMemo, useRef, useState } from "react";
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
  killingKey: string | null;
  /** Ports of the multi-listener watches whose per-listener rows are open.
   * Owned by App, because keyboard navigation must only reach visible rows. */
  expandedWatches: ReadonlySet<number>;
  onToggleWatchGroup: (port: number) => void;
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
  killingKey,
  expandedWatches,
  onToggleWatchGroup,
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
          <ul className={styles.rowList} role="listbox" aria-label="Watched ports">
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
              const first = listeners[0];
              const baseName = favourite.name ?? first?.label;
              const groupLabel =
                listeners.length > 1 ? `${baseName} (${listeners.length})` : baseName;
              const nameNode = (
                <WatchName
                  port={favourite.port}
                  label={groupLabel}
                  named={favourite.name !== undefined}
                  editing={editingPort === favourite.port}
                  initialValue={favourite.name ?? first?.label ?? ""}
                  onStartEdit={() => setEditingPort(favourite.port)}
                  onSubmit={handleRenameSubmit}
                  onCancel={() => setEditingPort(null)}
                />
              );
              // Status text stays in the DOM for screen readers (and tests);
              // the visible state is the free dot or the live row itself.
              const status = <span className={styles.srOnly}>{statusLabel}</span>;

              if (listeners.length === 1 && first) {
                const k = portKey(first);
                return (
                  <PortRow
                    key={favourite.port}
                    entry={first}
                    selected={k === selectedKey}
                    expanded={expandedKey === k}
                    armed={armedKey === k}
                    killing={killingKey === k}
                    killDisabled={stale}
                    labelNode={
                      <>
                        {nameNode}
                        {status}
                      </>
                    }
                    metaText={favourite.name !== undefined ? first.label : undefined}
                    onUnwatch={() => handleRemove(favourite.port)}
                    onSelect={() => onSelect(k)}
                    onToggleExpand={() => onToggleExpand(k)}
                    onRequestKill={() => onRequestKill(first)}
                    onDisarm={onDisarmKill}
                  />
                );
              }

              if (listeners.length > 1) {
                const open = expandedWatches.has(favourite.port);
                return (
                  <Fragment key={favourite.port}>
                    <li
                      className={styles.row}
                      role="option"
                      aria-selected={false}
                      onClick={() => onToggleWatchGroup(favourite.port)}
                    >
                      <div className={styles.rowMain}>
                        <span className={styles.port}>{favourite.port}</span>
                        <div className={styles.rowCenter}>
                          {nameNode}
                          {status}
                          <span className={styles.meta}>{listeners.length} listeners</span>
                        </div>
                        <div className={styles.actions}>
                          <UnwatchButton port={favourite.port} onClick={handleRemove} />
                          <button
                            type="button"
                            className={styles.watch}
                            aria-expanded={open}
                            aria-label={`${open ? "Hide" : "Show"} ${listeners.length} listeners on port ${favourite.port}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              onToggleWatchGroup(favourite.port);
                            }}
                          >
                            <Icon name={open ? "chevron-up" : "chevron-down"} />
                          </button>
                        </div>
                      </div>
                    </li>
                    {open &&
                      listeners.map((entry) => {
                        const k = portKey(entry);
                        return (
                          <PortRow
                            key={k}
                            nested
                            entry={entry}
                            selected={k === selectedKey}
                            expanded={expandedKey === k}
                            armed={armedKey === k}
                            killing={killingKey === k}
                            killDisabled={stale}
                            onSelect={() => onSelect(k)}
                            onToggleExpand={() => onToggleExpand(k)}
                            onRequestKill={() => onRequestKill(entry)}
                            onDisarm={onDisarmKill}
                          />
                        );
                      })}
                  </Fragment>
                );
              }

              // Nothing listening (or status unknown): not a navigation or kill target.
              return (
                <li key={favourite.port} className={styles.row} role="option" aria-selected={false}>
                  <div className={styles.rowMain}>
                    <span className={styles.port}>{favourite.port}</span>
                    <div className={styles.rowCenter}>
                      {nameNode}
                      {status}
                    </div>
                    <div className={styles.actions}>
                      <UnwatchButton port={favourite.port} onClick={handleRemove} />
                      {health === "fresh" || stale ? (
                        <span className={styles.freeTag}>
                          <span className={styles.freeDot} aria-hidden="true" />
                          free
                        </span>
                      ) : null}
                      <span className={styles.actionSpacer} aria-hidden="true" />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
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

function UnwatchButton({ port, onClick }: { port: number; onClick: (port: number) => void }) {
  return (
    <button
      type="button"
      className={`${styles.watch} ${styles.reveal}`}
      aria-label={`Remove watched port ${port}`}
      onClick={(e) => {
        e.stopPropagation();
        onClick(port);
      }}
    >
      <Icon name="star-off" />
    </button>
  );
}

interface WatchNameProps {
  port: number;
  /** What to show when not editing; undefined for a free, unnamed port. */
  label: string | undefined;
  named: boolean;
  editing: boolean;
  initialValue: string;
  onStartEdit: () => void;
  onSubmit: (port: number, nameInput: string) => void;
  onCancel: () => void;
}

/** The watch's name: click to rename inline (never a dialog). A pencil marks
 * names that can still be set, and shows on hover/focus for named ones. */
function WatchName({
  port,
  label,
  named,
  editing,
  initialValue,
  onStartEdit,
  onSubmit,
  onCancel,
}: WatchNameProps) {
  if (editing) {
    return (
      <WatchNameField
        port={port}
        initialValue={initialValue}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />
    );
  }
  return (
    <button
      type="button"
      className={styles.nameButton}
      aria-label={`Rename watched port ${port}`}
      onClick={(e) => {
        e.stopPropagation();
        onStartEdit();
      }}
    >
      <span className={label ? styles.label : styles.labelPlaceholder}>
        {label ?? "Name this port"}
      </span>
      <span className={named ? styles.namePencil : styles.namePencilAlways}>
        <Icon name="pencil" size={12} />
      </span>
    </button>
  );
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
      onClick={(e) => e.stopPropagation()}
      onKeyDown={handleKeyDown}
      onBlur={() => onSubmit(port, value)}
    />
  );
}
