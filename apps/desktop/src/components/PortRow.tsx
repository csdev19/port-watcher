import type { PortEntry } from "@/lib/types";
import { formatMemory, formatUptime, middleTruncate } from "@/lib/format";
import { useKillConfirm } from "@/hooks/use-kill-confirm";
import styles from "@/app.module.css";

interface Props {
  entry: PortEntry;
  selected: boolean;
  expanded: boolean;
  onSelect: () => void;
  onToggleExpand: () => void;
  onKill: () => void;
}

export function PortRow({ entry, selected, expanded, onSelect, onToggleExpand, onKill }: Props) {
  const confirm = useKillConfirm(onKill);

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
            className={confirm.armed ? styles.killArmed : styles.kill}
            aria-label={`Kill ${entry.label} on port ${entry.port}`}
            onClick={(e) => {
              e.stopPropagation();
              confirm.trigger();
            }}
            onMouseLeave={confirm.disarm}
          >
            {confirm.armed ? "Kill?" : "✕"}
          </button>
        ) : (
          <span
            className={styles.lock}
            data-tooltip="Belongs to another user"
            aria-label="Belongs to another user"
          >
            🔒
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
