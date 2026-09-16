import { portKey, type PortEntry } from "@/lib/types";
import { PortRow } from "./PortRow";
import styles from "@/app.module.css";

interface Props {
  entries: PortEntry[];
  selected: number;
  expandedKey: string | null;
  onSelect: (key: string) => void;
  onToggleExpand: (key: string) => void;
  onKill: (entry: PortEntry) => void;
}

export function PortList({
  entries,
  selected,
  expandedKey,
  onSelect,
  onToggleExpand,
  onKill,
}: Props) {
  return (
    <ul className={styles.list} role="listbox" aria-label="Listening ports">
      {entries.map((entry, i) => {
        const k = portKey(entry);
        return (
          <PortRow
            key={k}
            entry={entry}
            selected={i === selected}
            expanded={expandedKey === k}
            onSelect={() => onSelect(k)}
            onToggleExpand={() => onToggleExpand(k)}
            onKill={() => onKill(entry)}
          />
        );
      })}
    </ul>
  );
}
