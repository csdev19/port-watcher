import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ActiveAlert, Culprit } from "@/lib/alerts";
import { killProcess } from "@/lib/machine";
import { Icon } from "@/components/Icon";
import type { ToastData } from "@/components/Toast";
import styles from "@/machine.module.css";

const CONFIRM_WINDOW_MS = 2000;

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
  const queryClient = useQueryClient();
  const lead = leadAlert(alerts);
  const [armed, setArmed] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inFlight = useRef(false);

  const culpritId = lead?.culprit ? `${lead.culprit.pid}:${lead.culprit.startedAt}` : null;
  useEffect(() => {
    // A different culprit (or none) is never confirmed by an earlier arm.
    clearTimeout(timer.current);
    setArmed(null);
  }, [culpritId]);
  useEffect(() => () => clearTimeout(timer.current), []);

  if (!lead) return null;
  const { culprit } = lead;
  const more = alerts.length - 1;

  async function kill(target: Culprit) {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const result = await killProcess({ pid: target.pid, startedAt: target.startedAt });
      if (result === "terminated" || result === "killed") {
        onToast({ message: `${target.name} stopped`, command: null });
      } else if (result === "alreadyGone") {
        onToast({ message: `${target.name} was already gone`, command: null });
      } else {
        onToast({ message: `Cannot kill ${target.name}`, command: null });
      }
      void queryClient.invalidateQueries({ queryKey: ["top"] });
      void queryClient.invalidateQueries({ queryKey: ["ports"] });
    } catch (err) {
      onToast({ message: `Could not kill ${target.name}: ${String(err)}`, command: null });
    } finally {
      inFlight.current = false;
    }
  }

  function onKillClick() {
    if (!culprit || !culpritId) return;
    if (armed === culpritId) {
      clearTimeout(timer.current);
      setArmed(null);
      void kill(culprit);
      return;
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setArmed(null), CONFIRM_WINDOW_MS);
    setArmed(culpritId);
  }

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
      {culprit?.killable ? (
        <button
          type="button"
          className={armed === culpritId ? styles.procKillArmed : styles.procKill}
          aria-label={
            armed === culpritId ? `Confirm: kill ${culprit.name}` : `Kill ${culprit.name}`
          }
          onClick={onKillClick}
          onMouseLeave={() => {
            clearTimeout(timer.current);
            setArmed(null);
          }}
        >
          {armed === culpritId ? `Kill ${culprit.name}?` : <Icon name="x" />}
        </button>
      ) : null}
    </div>
  );
}
