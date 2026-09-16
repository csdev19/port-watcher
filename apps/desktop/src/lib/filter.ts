import type { PortEntry } from "./types";

/** Lowercased query substring-matches label, project, cwd, process name and
 * the executable/app-bundle paths — the same live-field haystack `filterPorts`
 * searches. Exported so `favourites.ts`'s search (F7 Slice 3) can match a
 * watch's live listener rows without duplicating this field list. `q` must
 * already be trimmed/lowercased by the caller. */
export function portMatchesLiveFields(entry: PortEntry, q: string): boolean {
  const haystack = [
    entry.label,
    entry.project ?? "",
    entry.cwd ?? "",
    entry.processName,
    entry.executablePath ?? "",
    entry.appBundlePath ?? "",
  ]
    .join("\n")
    .toLowerCase();
  return haystack.includes(q);
}

/**
 * One query, three fields (spec §4.5): a numeric query prefixes the port;
 * any query substring-matches label, project, cwd, process name, and the
 * executable/app-bundle paths (F6: so a collapsed Apps & System row can
 * still be found by search), case-insensitively. Does not extend to
 * arbitrary command arguments.
 */
export function filterPorts(entries: PortEntry[], query: string): PortEntry[] {
  const q = query.trim().toLowerCase();
  if (q === "") return entries;

  const isNumeric = /^\d+$/.test(q);
  return entries.filter((e) => {
    if (isNumeric && String(e.port).startsWith(q)) return true;
    return portMatchesLiveFields(e, q);
  });
}
