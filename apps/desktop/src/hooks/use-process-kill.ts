import { useCallback, useEffect, useRef, useState } from "react";
import type { ProcessGroupDto } from "@/lib/machine-types";

const CONFIRM_WINDOW_MS = 2000;

export interface ArmedProcess {
  key: string;
  pid: number;
  startedAt: number;
}

/** Two-step kill for Machine rows. Unlike Ports, there is no one-step path: not for the
 * keyboard, not when "Confirm before kill" is off, because a process in this list may be a
 * whole app. Arming binds to the exact process incarnation (pid + start time), so a row whose
 * target changed between polls can never be confirmed by an earlier arm. Locked rows never
 * arm. Rust re-validates everything on the actual kill (ADR 0006). */
export function useProcessKill(onConfirm: (group: ProcessGroupDto) => void) {
  const [armed, setArmedState] = useState<ArmedProcess | null>(null);
  const armedRef = useRef<ArmedProcess | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const setArmed = useCallback((next: ArmedProcess | null) => {
    armedRef.current = next;
    setArmedState(next);
  }, []);

  const disarm = useCallback(() => {
    clearTimeout(timer.current);
    setArmed(null);
  }, [setArmed]);

  const request = useCallback(
    (group: ProcessGroupDto) => {
      if (!group.killable || !group.target) {
        disarm();
        return;
      }
      const next = {
        key: group.key,
        pid: group.target.pid,
        startedAt: group.target.startedAt,
      };
      const prev = armedRef.current;
      if (
        prev &&
        prev.key === next.key &&
        prev.pid === next.pid &&
        prev.startedAt === next.startedAt
      ) {
        disarm();
        onConfirm(group);
        return;
      }
      clearTimeout(timer.current);
      timer.current = setTimeout(disarm, CONFIRM_WINDOW_MS);
      setArmed(next);
    },
    [disarm, onConfirm, setArmed],
  );

  useEffect(() => () => clearTimeout(timer.current), []);

  return { armed, request, disarm };
}
