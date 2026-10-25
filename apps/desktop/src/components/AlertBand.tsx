import type { ActiveAlert } from "@/lib/alerts";
import { AlertKillButton } from "@/components/AlertKillButton";
import type { ToastData } from "@/components/Toast";
import styles from "@/machine.module.css";

interface Props {
  alerts: ActiveAlert[];
  onToast: (toast: ToastData) => void;
}

/** The alert that leads the band: stop before watch, then the one that fired first. */
export function leadAlert(alerts: ActiveAlert[]): ActiveAlert | null {
  const rank = { ok: 0, watch: 1, stop: 2 } as const;
  return (
    [...alerts].sort(
      (a, b) => rank[b.level] - rank[a.level] || a.sinceEpochMs - b.sinceEpochMs,
    )[0] ?? null
  );
}

/** One band above the Machine gauges while at least one alert is firing (design 10a): severity
 * dot, what fired, who caused it, "+N" for the others. The ✕ is always two steps (like every
 * Machine kill) and appears only when Rust said the culprit is killable (ADR 0006); it signals
 * exactly the process the engine named, identified by pid and start time. */
export function AlertBand({ alerts, onToast }: Props) {
  const lead = leadAlert(alerts);
  if (!lead) return null;
  const { culprit } = lead;
  const more = alerts.length - 1;

  return (
    <div
      className={styles.alertBand}
      data-level={lead.level}
      role="status"
      aria-label="Active alert"
    >
      <span className={styles.alertLine}>
        <span className={styles.alertDot} aria-hidden />
        <span className={styles.alertText}>
          {lead.title}
          {culprit ? (
            <>
              {" · "}
              <span className={styles.alertCulprit}>{culprit.name}</span>
            </>
          ) : null}
        </span>
        {more > 0 ? <span className={styles.alertMore}>+{more}</span> : null}
      </span>
      {culprit ? <AlertKillButton culprit={culprit} onToast={onToast} /> : null}
    </div>
  );
}
