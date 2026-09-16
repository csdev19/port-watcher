import { useCallback, useRef, useState } from "react";
import {
  duplicatePortMessage,
  FAVOURITES_STORAGE_KEY,
  normalizeName,
  parsePortInput,
  sanitizeFavourites,
  type FavouritePort,
  type MutationResult,
} from "@/lib/favourites";

const MAX_NAME_LENGTH_MESSAGE = "Name must be 80 characters or fewer";
const INVALID_PORT_MESSAGE = "Enter a port number between 1 and 65535";
const LOAD_ERROR_MESSAGE = "Could not load watched ports";
const WRITE_ERROR_MESSAGE = "Could not save watched ports";

function readStoredFavourites(): { items: FavouritePort[]; error: string | null } {
  try {
    const raw = window.localStorage.getItem(FAVOURITES_STORAGE_KEY);
    if (raw === null) return { items: [], error: null };

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { items: [], error: LOAD_ERROR_MESSAGE };
    }

    const { items, changed } = sanitizeFavourites(parsed);
    return { items, error: changed ? LOAD_ERROR_MESSAGE : null };
  } catch {
    // Storage getter/getItem threw (e.g. unavailable/blocked). Read
    // failure must leave the rest of the app usable — empty list, no
    // write attempted here.
    return { items: [], error: LOAD_ERROR_MESSAGE };
  }
}

function writeStoredFavourites(items: FavouritePort[]): boolean {
  try {
    window.localStorage.setItem(FAVOURITES_STORAGE_KEY, JSON.stringify(items));
    return true;
  } catch {
    return false;
  }
}

/** F7 Slice 1: owns the validated, persisted favourites list. Mirrors the
 * `use-kill-confirm` pattern of keeping a ref in sync with state so
 * back-to-back actions (e.g. two `add` calls before a re-render) read the
 * latest list rather than a stale closure.
 *
 * Mutations compute the next array, synchronously serialize+write once,
 * then set state — never inside a state-updater callback or an
 * unconditional effect — so a failed write never leaves the UI showing a
 * "watched" port that won't survive restart. */
export function useFavourites() {
  const [{ items: initialItems, error: initialError }] = useState(readStoredFavourites);
  const [items, setItemsState] = useState<FavouritePort[]>(initialItems);
  const [error, setError] = useState<string | null>(initialError);
  const itemsRef = useRef<FavouritePort[]>(initialItems);

  const setItems = useCallback((next: FavouritePort[]) => {
    itemsRef.current = next;
    setItemsState(next);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const add = useCallback(
    (portInput: string, nameInput?: string): MutationResult => {
      const port = parsePortInput(portInput);
      if (port === null) return { ok: false, message: INVALID_PORT_MESSAGE };

      const normalizedName = normalizeName(nameInput);
      if (normalizedName === null) {
        return { ok: false, message: MAX_NAME_LENGTH_MESSAGE };
      }

      const current = itemsRef.current;
      if (current.some((f) => f.port === port)) {
        // Row watch action is idempotent: a duplicate submission does not
        // silently rename or add another record.
        return { ok: false, message: duplicatePortMessage(port) };
      }

      const record: FavouritePort =
        normalizedName === undefined ? { port } : { port, name: normalizedName };
      const next = [...current, record];

      if (!writeStoredFavourites(next)) {
        return { ok: false, message: WRITE_ERROR_MESSAGE };
      }

      setItems(next);
      return { ok: true };
    },
    [setItems],
  );

  const remove = useCallback(
    (port: number): MutationResult => {
      const current = itemsRef.current;
      const next = current.filter((f) => f.port !== port);
      if (next.length === current.length) return { ok: true };

      if (!writeStoredFavourites(next)) {
        return { ok: false, message: WRITE_ERROR_MESSAGE };
      }

      setItems(next);
      return { ok: true };
    },
    [setItems],
  );

  return { items, error, add, remove, clearError };
}
