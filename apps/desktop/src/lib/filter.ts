import type { PortEntry } from "./types";

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
    const haystack = [
      e.label,
      e.project ?? "",
      e.cwd ?? "",
      e.processName,
      e.executablePath ?? "",
      e.appBundlePath ?? "",
    ]
      .join("\n")
      .toLowerCase();
    return haystack.includes(q);
  });
}
