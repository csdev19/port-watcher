import { portKey, type PortEntry } from "@/lib/types";
import { PortRow } from "./PortRow";
import styles from "@/app.module.css";

interface Props {
  entries: PortEntry[];
  selected: number;
  expandedKey: string | null;
  /** Key of the row currently armed in App's shared kill-confirm instance. */
  armedKey: string | null;
  onSelect: (key: string) => void;
  onToggleExpand: (key: string) => void;
  onRequestKill: (entry: PortEntry) => void;
  onDisarmKill: () => void;
}

export function PortList({
  entries,
  selected,
  expandedKey,
  armedKey,
  onSelect,
  onToggleExpand,
  onRequestKill,
  onDisarmKill,
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
            armed={armedKey === k}
            onSelect={() => onSelect(k)}
            onToggleExpand={() => onToggleExpand(k)}
            onRequestKill={() => onRequestKill(entry)}
            onDisarm={onDisarmKill}
          />
        );
      })}
    </ul>
  );
}
