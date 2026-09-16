import { useCallback, useEffect, useState } from "react";
import { portKey, type PortEntry } from "@/lib/types";

export type NavAction = "expand" | "kill" | "close" | null;

/** ↑↓ move, Enter expand, ⌘⌫ kill, Esc close (spec §5 keyboard).
 * Works while the search input keeps focus.
 *
 * Selection is tracked by identity (`pid:port`), not array index: the
 * list is re-sorted by (port, pid) on every 2s poll, so an index-based
 * selection can silently drift onto a different row after a refetch —
 * with ⌘⌫ having zero confirmation, that drift can kill the wrong
 * process. Arrow-key movement still walks the `entries` array
 * internally to find "next"/"previous", but the key is always resolved
 * fresh against the current `entries` before being written to state. */
export function useListNavigation(entries: PortEntry[]) {
  const [selectedKey, setSelectedKeyState] = useState<string | null>(
    entries.length > 0 ? portKey(entries[0]) : null,
  );

  // If nothing is selected yet (initial empty list, or the panel just
  // opened before the first fetch resolved) and entries show up, pick
  // the first one. We deliberately do NOT do this when a selection
  // exists but its entry disappeared (filtered out / killed) — in that
  // case the highlight should simply vanish, never jump to another row.
  useEffect(() => {
    if (selectedKey === null && entries.length > 0) {
      setSelectedKeyState(portKey(entries[0]));
    }
  }, [entries, selectedKey]);

  const setSelectedKey = useCallback((k: string | null) => setSelectedKeyState(k), []);

  const move = useCallback(
    (delta: number) => {
      if (entries.length === 0) {
        setSelectedKeyState(null);
        return;
      }
      const currentIndex = entries.findIndex((e) => portKey(e) === selectedKey);
      const nextIndex = Math.min(Math.max(currentIndex + delta, 0), entries.length - 1);
      setSelectedKeyState(portKey(entries[nextIndex]));
    },
    [entries, selectedKey],
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
