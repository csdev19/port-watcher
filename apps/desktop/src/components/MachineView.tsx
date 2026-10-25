import type { ActiveAlert, FocusTarget } from "@/lib/alerts";
import type { MachineSnapshot } from "@/lib/machine-types";
import { AlertBand } from "@/components/AlertBand";
import { openFullWindow } from "@/lib/machine";
import { Icon } from "@/components/Icon";
import { Gauge } from "@/components/Gauge";
import { TopProcesses } from "@/components/TopProcesses";
import type { ToastData } from "@/components/Toast";
import styles from "@/machine.module.css";

interface Props {
  snapshot: MachineSnapshot | undefined;
  error: unknown;
  onToast: (toast: ToastData) => void;
  alerts: ActiveAlert[];
  /** A notification click asked for this row; cleared once handled. */
  focus: FocusTarget | null;
  onFocusHandled: () => void;
}

/** The Machine tab body: the alert band, four gauges, then the top processes. Scrolls if it
 * does not fit. */
export function MachineView({ snapshot, error, onToast, alerts, focus, onFocusHandled }: Props) {
  if (!snapshot) {
    return (
      <div className={styles.machine}>
        <AlertBand alerts={alerts} onToast={onToast} />
        <p className={styles.procEmpty}>
          {error ? `Could not read the machine: ${String(error)}` : "Reading the machine…"}
        </p>
      </div>
    );
  }
  const cpu = snapshot.gauges.find((g) => g.id === "cpu");
  return (
    <div className={styles.machine}>
      <AlertBand alerts={alerts} onToast={onToast} />
      <div className={styles.machineBar}>
        <button
          type="button"
          className={styles.expandButton}
          aria-label="Open full window"
          aria-keyshortcuts="Meta+Enter"
          data-tooltip="Open full window  ⌘↩"
          onClick={() => void openFullWindow()}
        >
          <Icon name="maximize-2" size={13} />
        </button>
      </div>
      {snapshot.gauges.map((g) => (
        <Gauge key={g.id} gauge={g} history={snapshot.history} nowMs={snapshot.sampledAtMs} />
      ))}
      <TopProcesses
        cores={snapshot.machine.cores}
        cpuWarn={cpu?.warn ?? null}
        onToast={onToast}
        focus={focus}
        onFocusHandled={onFocusHandled}
      />
    </div>
  );
}
