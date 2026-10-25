import { useCallback, useEffect, useRef, useState } from "react";
import { migrateLegacyFavourites } from "@/lib/favourites-migration";
import {
  getSetting,
  readCachedSetting,
  setSetting,
  subscribeSetting,
  writeCachedSetting,
} from "@/settings/store";
import {
  duplicatePortMessage,
  normalizeName,
  parsePortInput,
  sanitizeFavourites,
  type FavouritePort,
  type MutationResult,
} from "@/lib/favourites";

const MAX_NAME_LENGTH_MESSAGE = "Name must be 30 characters or fewer";
const INVALID_PORT_MESSAGE = "Enter a port number between 1 and 65535";
const LOAD_ERROR_MESSAGE = "Could not load watched ports";
const WRITE_ERROR_MESSAGE = "Could not save watched ports";

function sanitizeStored(raw: unknown): { items: FavouritePort[]; error: string | null } {
  const { items, changed } = sanitizeFavourites(raw);
  return { items, error: changed ? LOAD_ERROR_MESSAGE : null };
}

/** Owns the validated, persisted watched-ports list. It lives in `settings.json` (key
 * `favourites`, ADR 0013) so Rust can read it for the "watched port taken" alert and every
 * window shares it through the store's change event. The first run after the upgrade imports the
 * old `chapay.favourites` localStorage list once.
 *
 * Mutations keep the synchronous result the UI needs: they validate against a ref of the latest
 * list, show the new list at once, and save in the background. A failed save puts the previous
 * list back and reports it, so the UI never keeps a "watched" port that will not survive a
 * restart. */
export function useFavourites() {
  const [{ items: initialItems, error: initialError }] = useState(() =>
    sanitizeStored(readCachedSetting("favourites")),
  );
  const [items, setItemsState] = useState<FavouritePort[]>(initialItems);
  const [error, setError] = useState<string | null>(initialError);
  const itemsRef = useRef<FavouritePort[]>(initialItems);
  // Saves in flight. While any is, store updates are our own echoes and must not overwrite the
  // newer list shown on screen.
  const saving = useRef(0);
  // Set by the first edit: the first read of the store started before it and is out of date.
  const edited = useRef(false);

  const setItems = useCallback((next: FavouritePort[]) => {
    itemsRef.current = next;
    setItemsState(next);
  }, []);

  // The store is the source of truth: the first read (after the one-time import), and a change
  // made in the other window, both land here.
  useEffect(() => {
    let alive = true;
    const apply = (raw: unknown) => {
      const { items: next, error: nextError } = sanitizeStored(raw);
      writeCachedSetting("favourites", next);
      setItems(next);
      if (nextError) setError(nextError);
    };
    void migrateLegacyFavourites()
      .then(({ changed }) => {
        if (alive && changed) setError(LOAD_ERROR_MESSAGE);
        return getSetting("favourites");
      })
      .then((raw) => {
        if (alive && !edited.current) apply(raw);
      })
      .catch(() => {});
    const unsubscribe = subscribeSetting("favourites", (raw) => {
      if (alive && saving.current === 0) apply(raw);
    });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [setItems]);

  const save = useCallback(
    (previous: FavouritePort[], next: FavouritePort[]) => {
      edited.current = true;
      setItems(next);
      writeCachedSetting("favourites", next);
      saving.current += 1;
      setSetting("favourites", next)
        .catch(() => {
          // Only undo when nothing newer was saved in the meantime.
          if (itemsRef.current === next) setItems(previous);
          setError(WRITE_ERROR_MESSAGE);
        })
        .finally(() => {
          saving.current -= 1;
        });
    },
    [setItems],
  );

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

      save(current, next);
      return { ok: true };
    },
    [save],
  );

  const remove = useCallback(
    (port: number): MutationResult => {
      const current = itemsRef.current;
      const next = current.filter((f) => f.port !== port);
      if (next.length === current.length) return { ok: true };

      save(current, next);
      return { ok: true };
    },
    [save],
  );

  const rename = useCallback(
    (port: number, nameInput: string): MutationResult => {
      const normalizedName = normalizeName(nameInput);
      if (normalizedName === null) {
        return { ok: false, message: MAX_NAME_LENGTH_MESSAGE };
      }

      const current = itemsRef.current;
      const next = current.map((f) =>
        f.port === port
          ? normalizedName === undefined
            ? { port }
            : { port, name: normalizedName }
          : f,
      );

      save(current, next);
      return { ok: true };
    },
    [save],
  );

  return { items, error, add, remove, rename, clearError };
}
