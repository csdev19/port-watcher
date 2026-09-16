import { portKey, type PortEntry } from "@/lib/types";
import type { PortGroups } from "@/lib/port-groups";
import { PortRow } from "./PortRow";
import { Icon } from "@/components/Icon";
import styles from "@/app.module.css";

const SECONDARY_LIST_ID = "port-list-secondary";

interface Props {
  groups: PortGroups;
  /** Whether the Apps & System section is currently rendered. */
  secondaryOpen: boolean;
  /** True while search forces the section open — disables manual collapse. */
  secondaryForcedOpen: boolean;
  selectedKey: string | null;
  expandedKey: string | null;
  /** Key of the row currently armed in App's shared kill-confirm instance. */
  armedKey: string | null;
  onSelect: (key: string) => void;
  onToggleExpand: (key: string) => void;
  onRequestKill: (entry: PortEntry) => void;
  onDisarmKill: () => void;
  onToggleSecondary: () => void;
  /** F7 Slice 3: saved favourite port numbers — drives the star's
   * "watched"/"not watched" state on every listening row. */
  favouritePorts: Set<number>;
  onToggleWatch: (entry: PortEntry) => void;
}

function renderRows(
  entries: PortEntry[],
  selectedKey: string | null,
  expandedKey: string | null,
  armedKey: string | null,
  favouritePorts: Set<number>,
  onSelect: (key: string) => void,
  onToggleExpand: (key: string) => void,
  onRequestKill: (entry: PortEntry) => void,
  onDisarmKill: () => void,
  onToggleWatch: (entry: PortEntry) => void,
) {
  return entries.map((entry) => {
    const k = portKey(entry);
    return (
      <PortRow
        key={k}
        entry={entry}
        selected={k === selectedKey}
        expanded={expandedKey === k}
        armed={armedKey === k}
        watched={favouritePorts.has(entry.port)}
        onSelect={() => onSelect(k)}
        onToggleExpand={() => onToggleExpand(k)}
        onRequestKill={() => onRequestKill(entry)}
        onDisarm={onDisarmKill}
        onToggleWatch={() => onToggleWatch(entry)}
      />
    );
  });
}

export function PortList({
  groups,
  secondaryOpen,
  secondaryForcedOpen,
  selectedKey,
  expandedKey,
  armedKey,
  onSelect,
  onToggleExpand,
  onRequestKill,
  onDisarmKill,
  onToggleSecondary,
  favouritePorts,
  onToggleWatch,
}: Props) {
  const { dev, secondary } = groups;

  return (
    <div className={styles.list}>
      {dev.length > 0 && (
        <section className={styles.section}>
          <h3 className={styles.sectionHeading}>{dev.length} DEV</h3>
          <ul className={styles.rowList} role="listbox" aria-label="Dev ports">
            {renderRows(
              dev,
              selectedKey,
              expandedKey,
              armedKey,
              favouritePorts,
              onSelect,
              onToggleExpand,
              onRequestKill,
              onDisarmKill,
              onToggleWatch,
            )}
          </ul>
        </section>
      )}
      {secondary.length > 0 && (
        <section className={styles.section}>
          <button
            type="button"
            className={styles.disclosure}
            aria-expanded={secondaryOpen}
            aria-controls={secondaryOpen ? SECONDARY_LIST_ID : undefined}
            aria-label={
              secondaryForcedOpen ? "Apps & System — expanded for search results" : undefined
            }
            disabled={secondaryForcedOpen}
            onClick={onToggleSecondary}
          >
            <Icon name="chevron-right" size={12} />
            <span className={styles.disclosureLabel}>APPS &amp; SYSTEM · {secondary.length}</span>
          </button>
          {secondaryOpen && (
            <ul
              id={SECONDARY_LIST_ID}
              className={styles.rowList}
              role="listbox"
              aria-label="Apps & System ports"
            >
              {renderRows(
                secondary,
                selectedKey,
                expandedKey,
                armedKey,
                favouritePorts,
                onSelect,
                onToggleExpand,
                onRequestKill,
                onDisarmKill,
                onToggleWatch,
              )}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
