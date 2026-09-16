import { useCallback, useState } from "react";

export type NavAction = "expand" | "kill" | "close" | null;

/** ↑↓ move, Enter expand, ⌘⌫ kill, Esc close (spec §5 keyboard). Works
 * while the search input keeps focus. */
export function useListNavigation(count: number) {
  const [selected, setSelected] = useState(0);

  const clamp = useCallback(
    (i: number) => (count === 0 ? 0 : Math.min(Math.max(i, 0), count - 1)),
    [count],
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent): NavAction => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelected((i) => clamp(i + 1));
          return null;
        case "ArrowUp":
          e.preventDefault();
          setSelected((i) => clamp(i - 1));
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
    [clamp],
  );

  return { selected, setSelected: (i: number) => setSelected(clamp(i)), onKeyDown };
}
