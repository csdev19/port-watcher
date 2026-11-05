import { useCallback, useEffect, useState } from "react";

export type NavAction = "expand" | "kill" | "close" | null;

/** ↑↓ move, Enter expand, ⌘⌫ kill, Esc close (spec §5 keyboard).
 * Works while the search input keeps focus.
 *
 * Selection is tracked by identity (a row key built from `pid:port`), not
 * array index: the list is re-sorted by (port, pid) on every 2s poll, so
 * an index-based selection can silently drift onto a different row after
 * a refetch — with ⌘⌫ having zero confirmation, that drift can kill the
 * wrong process. `keys` are the visible rows' keys in render order;
 * arrow-key movement walks them to find "next"/"previous", but the key
 * is always resolved fresh against the current `keys` before being
 * written to state. */
export function useListNavigation(keys: readonly string[]) {
  const [selectedKey, setSelectedKeyState] = useState<string | null>(
    keys.length > 0 ? keys[0] : null,
  );

  // If nothing is selected yet (initial empty list, or the panel just
  // opened before the first fetch resolved) and entries show up, pick
  // the first one. We deliberately do NOT do this when a selection
  // exists but its row disappeared (filtered out / killed) — in that
  // case the highlight should simply vanish, never jump to another row.
  useEffect(() => {
    if (selectedKey === null && keys.length > 0) {
      setSelectedKeyState(keys[0]);
    }
  }, [keys, selectedKey]);

  const setSelectedKey = useCallback((k: string | null) => setSelectedKeyState(k), []);

  const move = useCallback(
    (delta: number) => {
      if (keys.length === 0) {
        setSelectedKeyState(null);
        return;
      }
      const currentIndex = keys.indexOf(selectedKey ?? "");
      const nextIndex = Math.min(Math.max(currentIndex + delta, 0), keys.length - 1);
      setSelectedKeyState(keys[nextIndex]);
    },
    [keys, selectedKey],
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent): NavAction => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          move(1);
          return null;
        case "ArrowUp":
          e.preventDefault();
          move(-1);
          return null;
        case "Enter":
          e.preventDefault();
          return "expand";
        case "Backspace":
          if (e.metaKey) {
            e.preventDefault();
            return "kill";
          }
          return null;
        case "Escape":
          return "close";
        default:
          return null;
      }
    },
    [move],
  );

  return { selectedKey, setSelectedKey, onKeyDown };
}
