import type { ProcessGroupDto } from "@/lib/machine-types";
import type { PortEntry } from "@/lib/types";

export type ProcessRowDto = ProcessGroupDto & { ports: number[] };

/** Adds the listening ports to each process row. The key is a member's (pid, startedAt) equal
 * to a port entry's (pid, startedAt): a reused PID has another start time, so it never picks
 * up the old process's ports. This is the only place the Ports and System health contexts
 * meet (ADR 0008); the two snapshots refresh on their own cadence and may differ by a poll. */
export function joinPorts(groups: ProcessGroupDto[], ports: PortEntry[]): ProcessRowDto[] {
  const byIncarnation = new Map<string, Set<number>>();
  for (const p of ports) {
    const key = `${p.pid}:${p.startedAt}`;
    const set = byIncarnation.get(key) ?? new Set<number>();
    set.add(p.port);
    byIncarnation.set(key, set);
  }
  return groups.map((g) => {
    const union = new Set<number>();
    for (const m of g.members) {
      for (const port of byIncarnation.get(`${m.pid}:${m.startedAt}`) ?? []) union.add(port);
    }
    return { ...g, ports: [...union].sort((a, b) => a - b) };
  });
}
