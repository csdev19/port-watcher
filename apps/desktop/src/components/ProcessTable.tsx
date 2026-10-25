import type { LockReason } from "@/lib/machine-types";
import type { ProcessRowDto } from "@/lib/process-table";
import { formatMemory } from "@/lib/format";
import { useGroupKill } from "@/hooks/use-group-kill";
import { Icon } from "@/components/Icon";
import type { ToastData } from "@/components/Toast";
import styles from "@/full/full.module.css";

const LOCK_TEXT: Record<LockReason, string> = {
  system: "macOS system process",
  otherUser: "Belongs to another user",
  self: "This is chapay itself",
};

const MAX_PORTS_SHOWN = 3;

interface Props {
  rows: ProcessRowDto[];
  loading: boolean;
  error: unknown;
  /** CPU gauge warn line, so a row colours by the same band as the gauge. */
  cpuWarn: number | null;
  onToast: (toast: ToastData) => void;
}

const pct = (n: number) => (n >= 10 ? n.toFixed(0) : n.toFixed(1));

/** The Overview's process table: one row per app, sorted by CPU as Rust returns it. The kill
 * button signals the row's one target process and always takes two clicks. */
export function ProcessTable({ rows, loading, error, cpuWarn, onToast }: Props) {
  const kill = useGroupKill(rows, onToast);

  if (rows.length === 0) {
    return (
      <p className={styles.tableEmpty}>
        {error
          ? `Could not read processes: ${String(error)}`
          : loading
            ? "collecting…"
            : "No processes to show."}
      </p>
    );
  }

  return (
    <table className={styles.table}>
      <caption className={styles.srOnly}>Processes, by CPU</caption>
      <thead>
        <tr>
          <th scope="col">Process</th>
          <th scope="col" className={styles.num}>
            CPU
          </th>
          <th scope="col" className={styles.num}>
            GPU
          </th>
          <th scope="col" className={styles.num}>
            Memory
          </th>
          <th scope="col">Ports</th>
          <th scope="col">
            <span className={styles.srOnly}>Stop</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const armed = kill.armed?.key === row.key;
          const lock = row.lockReason ? LOCK_TEXT[row.lockReason] : "Cannot be stopped from here";
          const hot = cpuWarn !== null && row.cpuPct >= cpuWarn;
          return (
            <tr key={row.key} data-testid="process-row">
              <th scope="row" className={styles.procCell}>
                <span className={styles.procName}>{row.name}</span>
                <span className={styles.procSub}>{row.sub}</span>
              </th>
              <td className={styles.num} data-level={hot ? "watch" : "ok"}>
                {pct(row.cpuPct)}%
              </td>
              <td className={styles.num}>
                {row.gpuPct === null ? (
                  <span aria-label="not available">—</span>
                ) : (
                  `${pct(row.gpuPct)}%`
                )}
              </td>
              <td className={styles.num}>{formatMemory(row.memBytes)}</td>
              <td>
                {row.ports.length === 0 ? (
                  <span className={styles.muted} aria-label="no listening ports">
                    —
                  </span>
                ) : (
                  <span className={styles.ports}>
                    {row.ports.slice(0, MAX_PORTS_SHOWN).map((p) => (
                      <span key={p} className={styles.portChip}>
                        :{p}
                      </span>
                    ))}
                    {row.ports.length > MAX_PORTS_SHOWN && (
                      <span className={styles.muted}>+{row.ports.length - MAX_PORTS_SHOWN}</span>
                    )}
                  </span>
                )}
              </td>
              <td className={styles.actionCell}>
                {row.killable && row.target ? (
                  <button
                    type="button"
                    className={armed ? styles.killArmed : styles.kill}
                    aria-label={
                      armed ? `Confirm: kill ${row.targetName}` : `Kill ${row.targetName}`
                    }
                    onClick={() => kill.request(row)}
                    onMouseLeave={kill.disarm}
                  >
                    {armed ? `Kill ${row.targetName}?` : <Icon name="x" />}
                  </button>
                ) : (
                  <span className={styles.lock} aria-label={lock} data-tooltip={lock} role="img">
                    <Icon name="lock" />
                  </span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
