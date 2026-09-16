import type { PortEntry } from "./types";

/**
 * One query, three fields (spec §4.5): a numeric query prefixes the port;
 * any query substring-matches label, project, cwd and process name,
 * case-insensitively.
 */
export function filterPorts(entries: PortEntry[], query: string): PortEntry[] {
  const q = query.trim().toLowerCase();
  if (q === "") return entries;

  const isNumeric = /^\d+$/.test(q);
  return entries.filter((e) => {
    if (isNumeric && String(e.port).startsWith(q)) return true;
    const haystack = [e.label, e.project ?? "", e.cwd ?? "", e.processName]
      .join("\n")
      .toLowerCase();
    return haystack.includes(q);
  });
}
