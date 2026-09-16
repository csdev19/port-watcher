import type { PortEntry } from "./types";

export interface PortGroups {
  /** `dev` entries, in input order. */
  dev: PortEntry[];
  /** `app` and `system` entries, in input order. */
  secondary: PortEntry[];
}

/**
 * Pure partition of already-filtered entries into the two sections the
 * panel renders: `dev` (always shown) and `secondary` (`app`/`system`,
 * collapsed by default — see F6 ADR 0001). Preserves the input's
 * `(port, pid)` ordering within each group; does not re-sort.
 */
export function partitionPorts(entries: PortEntry[]): PortGroups {
  const dev: PortEntry[] = [];
  const secondary: PortEntry[] = [];
  for (const entry of entries) {
    if (entry.category === "dev") {
      dev.push(entry);
    } else {
      secondary.push(entry);
    }
  }
  return { dev, secondary };
}
