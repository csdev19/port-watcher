import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Culprit } from "@/lib/alerts";
import { killProcess } from "@/lib/machine";
import { Icon } from "@/components/Icon";
import type { ToastData } from "@/components/Toast";
import styles from "@/machine.module.css";

const CONFIRM_WINDOW_MS = 2000;

interface Props {
  culprit: Culprit;
  onToast: (toast: ToastData) => void;
}

/** The ✕ next to an alert's culprit, shared by the mini panel's band and the full window's
 * Alerts page. Always two steps (like every Machine kill) and shown only when Rust said the
 * culprit is killable (ADR 0006); it signals exactly the process the engine named, identified
 * by pid and start time, and Rust re-validates on the kill. */
export function AlertKillButton({ culprit, onToast }: Props) {
  const queryClient = useQueryClient();
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inFlight = useRef(false);

  const culpritId = `${culprit.pid}:${culprit.startedAt}`;
  useEffect(() => {
    // A different culprit is never confirmed by an earlier arm.
    clearTimeout(timer.current);
    setArmed(false);
  }, [culpritId]);
  useEffect(() => () => clearTimeout(timer.current), []);

  if (!culprit.killable) return null;

  async function kill() {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const result = await killProcess({
        pid: culprit.pid,
        startedAt: culprit.startedAt,
      });
      if (result === "terminated" || result === "killed") {
        onToast({ message: `${culprit.name} stopped`, command: null });
      } else if (result === "alreadyGone") {
        onToast({ message: `${culprit.name} was already gone`, command: null });
      } else {
        onToast({ message: `Cannot kill ${culprit.name}`, command: null });
      }
      void queryClient.invalidateQueries({ queryKey: ["top"] });
      void queryClient.invalidateQueries({ queryKey: ["ports"] });
    } catch (err) {
      onToast({
        message: `Could not kill ${culprit.name}: ${String(err)}`,
        command: null,
      });
    } finally {
      inFlight.current = false;
    }
  }

  function onClick() {
    clearTimeout(timer.current);
    if (armed) {
      setArmed(false);
      void kill();
      return;
    }
    timer.current = setTimeout(() => setArmed(false), CONFIRM_WINDOW_MS);
    setArmed(true);
  }

  return (
    <button
      type="button"
      className={armed ? styles.procKillArmed : styles.procKill}
      aria-label={armed ? `Confirm: kill ${culprit.name}` : `Kill ${culprit.name}`}
      onClick={onClick}
      onMouseLeave={() => {
        clearTimeout(timer.current);
        setArmed(false);
      }}
    >
      {armed ? `Kill ${culprit.name}?` : <Icon name="x" />}
    </button>
  );
}
