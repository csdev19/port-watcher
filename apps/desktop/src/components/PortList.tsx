import type { PortEntry } from "@/lib/types";
import { PortRow } from "./PortRow";
import styles from "@/app.module.css";

interface Props {
  entries: PortEntry[];
  selected: number;
  expandedPid: number | null;
  onSelect: (index: number) => void;
  onToggleExpand: (pid: number) => void;
  onKill: (entry: PortEntry) => void;
}

export function PortList({
  entries,
  selected,
  expandedPid,
  onSelect,
  onToggleExpand,
  onKill,
}: Props) {
  return (
    <ul className={styles.list} role="listbox" aria-label="Listening ports">
      {entries.map((entry, i) => (
        <PortRow
          key={`${entry.pid}:${entry.port}`}
          entry={entry}
          selected={i === selected}
          expanded={expandedPid === entry.pid}
          onSelect={() => onSelect(i)}
          onToggleExpand={() => onToggleExpand(entry.pid)}
          onKill={() => onKill(entry)}
        />
      ))}
    </ul>
  );
}
