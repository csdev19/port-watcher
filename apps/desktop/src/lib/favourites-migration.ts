import { hasSetting, setSetting } from "@/settings/store";
import { FAVOURITES_STORAGE_KEY, sanitizeFavourites } from "@/lib/favourites";

export interface MigrationResult {
  /** The old list had records that were dropped or fixed while importing. */
  changed: boolean;
}

async function run(): Promise<MigrationResult> {
  // Already in settings.json (even as an empty list): nothing to import, ever again.
  if (await hasSetting("favourites")) return { changed: false };

  let raw: string | null;
  try {
    raw = window.localStorage.getItem(FAVOURITES_STORAGE_KEY);
  } catch {
    return { changed: false };
  }
  if (raw === null) return { changed: false };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Unreadable old list: leave the key absent so the import can retry, and say so.
    return { changed: true };
  }
  const { items, changed } = sanitizeFavourites(parsed);
  // The old localStorage key is deliberately left in place (ADR 0013): the release that moved
  // the list must be reversible, and an older build still reads it.
  await setSetting("favourites", items);
  return { changed };
}

let migration: Promise<MigrationResult> | null = null;

/** Imports the pre-0.3 `chapay.favourites` localStorage list into `settings.json` once. Every
 * window may call it; they share one run, and a second window finds the key present. */
export function migrateLegacyFavourites(): Promise<MigrationResult> {
  migration ??= run().catch(() => ({ changed: false }));
  return migration;
}

/** Test helper: forget that the migration ran. */
export function resetFavouritesMigration(): void {
  migration = null;
}
