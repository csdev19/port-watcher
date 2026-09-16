import { useCallback, useEffect, useRef, useState } from "react";
import { portKey, type PortEntry } from "@/lib/types";

const CONFIRM_WINDOW_MS = 2000;

export interface ArmedTarget {
  key: string;
  /** The armed entry's `startedAt` at request time — doubles as an
   * incarnation guard: a same-key entry with a different `startedAt`
   * (pid/port reused by a new process) can never confirm a stale arm. */
  startedAt: number;
}

/** Spec §5 / F6 Slice 2: one shared confirmation state for both pointer
 * and keyboard kill requests, owned by App so neither input path can
 * bypass the other's two-step guard.
 *
 * `dev` entries keep the pre-F6 behavior per input: a mouse click still
 * arms-then-confirms, but `⌘⌫` on a `dev` row kills immediately.
 * `app`/`system` entries always require two actions within 2s,
 * regardless of source. Unkillable entries never arm. */
export function useKillConfirm(onConfirm: (entry: PortEntry) => void) {
  const [armedTarget, setArmedTargetState] = useState<ArmedTarget | null>(null);
  // Mirrors `armedTarget` synchronously so `request` can read the latest
  // value without depending on (and re-creating on) React state.
  const armedRef = useRef<ArmedTarget | null>(null);
  // React 19: useRef requires an initial value.
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const setArmedTarget = useCallback((next: ArmedTarget | null) => {
    armedRef.current = next;
    setArmedTargetState(next);
  }, []);

  const disarm = useCallback(() => {
    clearTimeout(timer.current);
    setArmedTarget(null);
  }, [setArmedTarget]);

  const request = useCallback(
    (entry: PortEntry, source: "pointer" | "keyboard") => {
      if (!entry.killable) {
        disarm();
        return;
      }

      if (source === "keyboard" && entry.category === "dev") {
        disarm();
        onConfirm(entry);
        return;
      }

      const key = portKey(entry);
      const prev = armedRef.current;

      if (prev && prev.key === key && prev.startedAt === entry.startedAt) {
        // Same protected request, same incarnation, within the window: confirm.
        disarm();
        onConfirm(entry);
        return;
      }

      // New key, new incarnation, or nothing armed: (re)arm and restart the timer.
      clearTimeout(timer.current);
      timer.current = setTimeout(disarm, CONFIRM_WINDOW_MS);
      setArmedTarget({ key, startedAt: entry.startedAt });
    },
    [disarm, onConfirm, setArmedTarget],
  );

  useEffect(() => () => clearTimeout(timer.current), []);

  return { armedTarget, request, disarm };
}
