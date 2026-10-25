import { useState } from "react";
import { AlertKillButton } from "@/components/AlertKillButton";
import type { ToastData } from "@/components/Toast";
import { useAlertRules } from "@/hooks/use-alert-rules";
import type { ActiveAlert, AlertRuleId } from "@/lib/alerts";
import { setAlertRuleEnabled } from "@/settings/native";
import { Switch } from "@/settings/ui";
import styles from "./full.module.css";

interface Props {
  alerts: ActiveAlert[];
  onToast: (toast: ToastData) => void;
}

/** Alerts (design 10b): what is firing now, with the culprit and the same two-step ✕ as the
 * mini panel, then every rule with its switch. The rules are fixed (ADR 0011): no "Add a
 * rule", no thresholds to edit. A switch moves only after Rust accepts the change. */
export function AlertsPage({ alerts, onToast }: Props) {
  const { rules, patch } = useAlertRules();
  const [failed, setFailed] = useState<AlertRuleId | null>(null);

  const toggle = (id: AlertRuleId, next: boolean) => {
    setFailed(null);
    setAlertRuleEnabled(id, next).then(
      () => patch(id, next),
      () => setFailed(id),
    );
  };

  return (
    <div className={styles.overview}>
      <section className={styles.card} aria-label="Active alerts">
        <h2 className={styles.asideTitle}>Firing now</h2>
        {alerts.length === 0 ? (
          <p className={styles.note}>Nothing is firing.</p>
        ) : (
          <ul className={styles.alertList}>
            {alerts.map((a) => (
              <li key={a.id} className={styles.alertItem} data-level={a.level}>
                <span className={styles.alertItemDot} aria-hidden />
                <span className={styles.alertItemText}>
                  <span className={styles.procName}>{a.title}</span>
                  <span className={styles.procSub}>
                    {a.reading}
                    {a.culprit ? ` · ${a.culprit.name}` : ""}
                  </span>
                </span>
                {a.culprit ? <AlertKillButton culprit={a.culprit} onToast={onToast} /> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className={styles.card} aria-label="Alert rules">
        <h2 className={styles.asideTitle}>Rules</h2>
        <ul className={styles.alertList}>
          {rules.map((r) => (
            <li key={r.id} className={styles.alertItem} data-firing={r.firing}>
              <span className={styles.alertItemText}>
                <span className={styles.procName}>{r.title}</span>
                <span className={styles.procSub}>{r.sub}</span>
                {failed === r.id ? (
                  <span className={styles.note} role="alert">
                    {`Couldn't change this alert. Try again.`}
                  </span>
                ) : null}
              </span>
              {r.firing ? <span className={styles.firingTag}>Firing</span> : null}
              <Switch label={r.title} checked={r.enabled} onChange={(v) => toggle(r.id, v)} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
