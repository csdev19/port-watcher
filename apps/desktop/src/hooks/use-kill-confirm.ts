import { useCallback, useEffect, useRef, useState } from "react";

const CONFIRM_WINDOW_MS = 2000;

/** Spec §5: ✕ becomes "Kill?" for 2 s; the second click confirms. */
export function useKillConfirm(onConfirm: () => void) {
  const [armed, setArmed] = useState(false);
  // React 19: useRef requires an initial value.
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const disarm = useCallback(() => {
    clearTimeout(timer.current);
    setArmed(false);
  }, []);

  const trigger = useCallback(() => {
    if (armed) {
      disarm();
      onConfirm();
      return;
    }
    setArmed(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setArmed(false), CONFIRM_WINDOW_MS);
  }, [armed, disarm, onConfirm]);

  useEffect(() => () => clearTimeout(timer.current), []);

  return { armed, trigger, disarm };
}
