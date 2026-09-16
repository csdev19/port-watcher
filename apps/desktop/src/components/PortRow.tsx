import type { PortEntry } from "@/lib/types";
import { formatMemory, formatUptime, middleTruncate } from "@/lib/format";
import { Icon } from "@/components/Icon";
import styles from "@/app.module.css";

interface Props {
  entry: PortEntry;
  selected: boolean;
  expanded: boolean;
  /** Owned by App's shared `useKillConfirm` — true while this row's key
   * is the armed target (F6 Slice 2: pointer and keyboard share one
   * confirmation instance so neither path can bypass the other). */
  armed: boolean;
  onSelect: () => void;
  onToggleExpand: () => void;
  onRequestKill: () => void;
  onDisarm: () => void;
}

export function PortRow({
  entry,
  selected,
  expanded,
  armed,
  onSelect,
  onToggleExpand,
  onRequestKill,
  onDisarm,
}: Props) {
  const protectedCategory = entry.category !== "dev";
  const confirmLabel = entry.category === "system" ? "Kill system?" : "Kill app?";

  return (
    <li
      className={selected ? `${styles.row} ${styles.rowSelected}` : styles.row}
      onMouseEnter={onSelect}
      onClick={onToggleExpand}
      role="option"
      aria-selected={selected}
    >
      <div className={styles.rowMain}>
        <span className={styles.port}>{entry.port}</span>
        <div className={styles.rowCenter}>
          <span className={styles.label}>{entry.label}</span>
          <span className={styles.meta}>
            {entry.cwd ? middleTruncate(entry.cwd, 34) : (entry.project ?? entry.processName)}
          </span>
        </div>
        <span className={styles.uptime}>{formatUptime(entry.startedAt)}</span>
        {entry.killable ? (
          <button
            type="button"
            className={
              armed
                ? protectedCategory
                  ? styles.killArmedNeutral
                  : styles.killArmed
                : protectedCategory
                  ? styles.killNeutral
                  : styles.kill
            }
            aria-label={`Kill ${entry.label} on port ${entry.port}`}
            onClick={(e) => {
              e.stopPropagation();
              onRequestKill();
            }}
            onMouseLeave={onDisarm}
          >
            {armed ? protectedCategory ? confirmLabel : "Kill?" : <Icon name="x" />}
          </button>
        ) : (
          <span
            className={styles.lock}
            data-tooltip="Belongs to another user"
            aria-label="Belongs to another user"
          >
            <Icon name="lock" />
          </span>
        )}
      </div>
      {expanded && (
        <dl className={styles.detail} onClick={(e) => e.stopPropagation()}>
          <dt>PID</dt>
          <dd>{entry.pid}</dd>
          <dt>User</dt>
          <dd>{entry.user ?? "—"}</dd>
          <dt>Memory</dt>
          <dd>{formatMemory(entry.memoryBytes)}</dd>
          <dt>Command</dt>
          <dd className={styles.command}>{entry.command}</dd>
        </dl>
      )}
    </li>
  );
}
