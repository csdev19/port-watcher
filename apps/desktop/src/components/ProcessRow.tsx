import type { LockReason, ProcessGroupDto } from "@/lib/machine-types";
import { formatMemory } from "@/lib/format";
import { Icon } from "@/components/Icon";
import styles from "@/machine.module.css";

const LOCK_TEXT: Record<LockReason, string> = {
  system: "macOS system process",
  otherUser: "Belongs to another user",
  self: "This is chapay itself",
};

interface Props {
  group: ProcessGroupDto;
  cores: number;
  /** CPU gauge warn line, so the row colours by the same band. */
  cpuWarn: number | null;
  selected: boolean;
  armed: boolean;
  onSelect: () => void;
  onRequestKill: () => void;
  onDisarm: () => void;
}

/** A top-by-CPU row. The percentage is a share of the whole machine; the tooltip-style
 * `title`-free hint "≈ 2.6 of 12 cores" is in the accessible name. One kill button per row,
 * and it signals one process. */
export function ProcessRow({
  group,
  cores,
  cpuWarn,
  selected,
  armed,
  onSelect,
  onRequestKill,
  onDisarm,
}: Props) {
  const pct = group.cpuPct;
  const coresBusy = ((pct / 100) * cores).toFixed(1);
  const hot = cpuWarn !== null && pct >= cpuWarn;
  const lock = group.lockReason ? LOCK_TEXT[group.lockReason] : "Cannot be stopped from here";
  return (
    <li
      className={selected ? `${styles.procRow} ${styles.procRowSelected}` : styles.procRow}
      data-testid="process-row"
      onMouseEnter={onSelect}
    >
      <span
        className={styles.procCpu}
        data-level={hot ? "watch" : "ok"}
        aria-label={`${pct.toFixed(0)} percent of the machine, about ${coresBusy} of ${cores} cores`}
      >
        {pct >= 10 ? pct.toFixed(0) : pct.toFixed(1)}%
      </span>
      <div className={styles.procMain}>
        <div className={styles.procName}>{group.name}</div>
        <div className={styles.procSub}>{group.sub}</div>
      </div>
      <div className={styles.procActions}>
        <span className={styles.procMem}>{formatMemory(group.memBytes)}</span>
        {group.killable && group.target ? (
          <button
            type="button"
            className={armed ? styles.procKillArmed : styles.procKill}
            aria-label={armed ? `Confirm: kill ${group.targetName}` : `Kill ${group.targetName}`}
            onClick={(e) => {
              e.stopPropagation();
              onRequestKill();
            }}
            onMouseLeave={onDisarm}
          >
            {armed ? `Kill ${group.targetName}?` : <Icon name="x" />}
          </button>
        ) : (
          <span className={styles.procLock} data-tooltip={lock} aria-label={lock} role="img">
            <Icon name="lock" />
          </span>
        )}
      </div>
    </li>
  );
}
