import type { PortEntry } from "./types";
import { portMatchesLiveFields } from "./filter";

/** F7 Slice 1: a favourite is a saved port number, not a process, address,
 * reservation or background monitor. It survives restarts via localStorage;
 * live presentation (join against `usePorts` snapshots) is Slice 2+. */
export interface FavouritePort {
  port: number;
  name?: string;
}

/** F7 Slice 2: one saved favourite joined against the latest live snapshot.
 * `listeners` is empty when nothing is currently listening on that port. */
export interface FavouriteMatch {
  favourite: FavouritePort;
  listeners: PortEntry[];
}

export const FAVOURITES_STORAGE_KEY = "chapay.favourites";

const MAX_NAME_LENGTH = 30;
const MIN_PORT = 1;
const MAX_PORT = 65535;

export type MutationResult = { ok: true } | { ok: false; message: string };

/** Trimmed, digit-only input in [1, 65535]. Rejects empty, signs, decimals,
 * exponent notation, NaN/Infinity and out-of-range. Leading zeros are
 * accepted and normalized ("03000" -> 3000). */
export function parsePortInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(value)) return null;
  if (value < MIN_PORT || value > MAX_PORT) return null;
  return value;
}

/** Trims the name, omitting it entirely when empty. Returns `null` when the
 * trimmed name exceeds the 80-character limit (caller should treat this as
 * a validation failure, not silent truncation). */
export function normalizeName(raw: string | undefined): string | undefined | null {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  if (trimmed.length > MAX_NAME_LENGTH) return null;
  return trimmed;
}

export function duplicatePortMessage(port: number): string {
  return `Port ${port} is already watched`;
}

/** Discards malformed records, keeps the first valid occurrence of each
 * port (insertion order preserved), strips unknown fields, and drops
 * invalid names while retaining an otherwise-valid port. Returns whether
 * anything was normalized/discarded so the caller can surface a
 * non-blocking recovery notice — this function never writes to storage. */
export function sanitizeFavourites(raw: unknown): {
  items: FavouritePort[];
  changed: boolean;
} {
  if (!Array.isArray(raw)) return { items: [], changed: raw !== undefined };

  const items: FavouritePort[] = [];
  const seenPorts = new Set<number>();
  let changed = false;

  for (const entry of raw) {
    if (entry === null || typeof entry !== "object") {
      changed = true;
      continue;
    }
    const record = entry as Record<string, unknown>;
    const portValue = record.port;
    if (typeof portValue !== "number" || !Number.isInteger(portValue)) {
      changed = true;
      continue;
    }
    if (portValue < MIN_PORT || portValue > MAX_PORT) {
      changed = true;
      continue;
    }
    if (seenPorts.has(portValue)) {
      changed = true;
      continue;
    }

    let name: string | undefined;
    if (record.name !== undefined) {
      if (typeof record.name !== "string") {
        changed = true;
      } else {
        const normalized = normalizeName(record.name);
        if (normalized === null) {
          // Too long: drop the name, keep the port.
          changed = true;
        } else if (normalized !== undefined) {
          name = normalized;
        } else if (record.name !== "") {
          // Whitespace-only name collapsed to undefined.
          changed = true;
        }
      }
    }

    const extraKeys = Object.keys(record).filter((k) => k !== "port" && k !== "name");
    if (extraKeys.length > 0) changed = true;

    seenPorts.add(portValue);
    items.push(name === undefined ? { port: portValue } : { port: portValue, name });
  }

  return { items, changed };
}

/**
 * Pure join of saved favourites against a live snapshot. Groups entries by
 * port number in one pass (no per-favourite `find`, no Rust IPv4/IPv6
 * dedupe), then maps favourites in saved order, preserving snapshot order
 * within each `listeners` array. Neither `items` nor `entries` is mutated;
 * a favourite with no current listener gets an empty array, never a
 * fabricated or persisted-metadata row — live fields always come from the
 * snapshot passed in, never from an earlier run.
 */
export function joinFavourites(items: FavouritePort[], entries: PortEntry[]): FavouriteMatch[] {
  const byPort = new Map<number, PortEntry[]>();
  for (const entry of entries) {
    const existing = byPort.get(entry.port);
    if (existing) {
      existing.push(entry);
    } else {
      byPort.set(entry.port, [entry]);
    }
  }

  return items.map((favourite) => ({
    favourite,
    listeners: byPort.get(favourite.port) ?? [],
  }));
}

/**
 * F7 Slice 3: Favourites-tab search. Matches the saved port's numeric
 * prefix, the saved name, or any listener's live fields (the same haystack
 * `filterPorts` searches). A match on *any part* of a watch keeps the whole
 * watch — heading plus every listener row — so other processes sharing the
 * port are never silently hidden by a partial match.
 */
export function filterFavouriteMatches(matches: FavouriteMatch[], query: string): FavouriteMatch[] {
  const q = query.trim().toLowerCase();
  if (q === "") return matches;

  const isNumeric = /^\d+$/.test(q);
  return matches.filter(({ favourite, listeners }) => {
    if (isNumeric && String(favourite.port).startsWith(q)) return true;
    if (favourite.name && favourite.name.toLowerCase().includes(q)) return true;
    return listeners.some((entry) => portMatchesLiveFields(entry, q));
  });
}

/**
 * F7 Slice 2/3: query-health classification shared by `App` (footer text)
 * and `FavouritesPanel` (per-watch presentation). `data === undefined`
 * means no successful snapshot has landed yet; TanStack Query keeps the
 * last successful `data` around across a background refetch error, which
 * is what distinguishes "stale" (retained data + error) from "unavailable"
 * (no data ever, plus error).
 */
export type FavouritesQueryHealth = "checking" | "unavailable" | "fresh" | "stale";

export function favouritesQueryHealth(
  data: PortEntry[] | undefined,
  queryError: unknown,
): FavouritesQueryHealth {
  if (data === undefined) return queryError ? "unavailable" : "checking";
  return queryError ? "stale" : "fresh";
}

/** Footer text: `N watched · M in use`, where `M` counts favourites with at
 * least one listener (never a PID sum), covering *all* favourites, not
 * just search matches. Honest about query health: no fabricated counts
 * before the first successful snapshot, and a `· update failed` suffix on
 * stale (retained) counts. */
export function favouritesFooterText(
  favouritesCount: number,
  matches: FavouriteMatch[],
  health: FavouritesQueryHealth,
): string {
  const watchedCount = `${favouritesCount} watched`;
  switch (health) {
    case "checking":
      return `${watchedCount} · checking…`;
    case "unavailable":
      return `${watchedCount} · status unavailable`;
    case "stale": {
      const inUse = matches.filter((m) => m.listeners.length > 0).length;
      return `${watchedCount} · ${inUse} in use · update failed`;
    }
    case "fresh": {
      const inUse = matches.filter((m) => m.listeners.length > 0).length;
      return `${watchedCount} · ${inUse} in use`;
    }
  }
}
