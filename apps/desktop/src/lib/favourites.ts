/** F7 Slice 1: a favourite is a saved port number, not a process, address,
 * reservation or background monitor. It survives restarts via localStorage;
 * live presentation (join against `usePorts` snapshots) is Slice 2+. */
export interface FavouritePort {
  port: number;
  name?: string;
}

export const FAVOURITES_STORAGE_KEY = "chapay.favourites";

const MAX_NAME_LENGTH = 80;
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
