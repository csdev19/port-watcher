import { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useProcessKill } from "@/hooks/use-process-kill";
import { killProcess } from "@/lib/machine";
import type { ProcessGroupDto } from "@/lib/machine-types";
import type { ToastData } from "@/components/Toast";

/** Two-step kill for a process table. Arming is `useProcessKill` (bound to pid + start time);
 * confirming re-resolves the row from the freshest list and signals the one target process
 * through `kill_process`, where Rust enforces the policy (ADR 0006). */
export function useGroupKill(rows: ProcessGroupDto[], onToast: (toast: ToastData) => void) {
  const queryClient = useQueryClient();
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const inFlight = useRef<Set<string>>(new Set());

  const handleKill = useCallback(
    async (group: ProcessGroupDto) => {
      const current = rowsRef.current.find((r) => r.key === group.key);
      const t = current?.target;
      if (
        !current ||
        !current.killable ||
        !t ||
        !group.target ||
        t.pid !== group.target.pid ||
        t.startedAt !== group.target.startedAt
      ) {
        return;
      }
      const id = `${t.pid}:${t.startedAt}`;
      if (inFlight.current.has(id)) return;
      inFlight.current.add(id);
      const name = current.targetName;
      try {
        const result = await killProcess(t);
        if (result === "terminated" || result === "killed") {
          onToast({ message: `${name} stopped`, command: null });
        } else if (result === "alreadyGone") {
          onToast({ message: `${name} was already gone`, command: null });
        } else {
          onToast({ message: `Cannot kill ${name}`, command: null });
        }
        void queryClient.invalidateQueries({ queryKey: ["processes"] });
        void queryClient.invalidateQueries({ queryKey: ["ports"] });
      } catch (err) {
        onToast({
          message: `Could not kill ${name}: ${String(err)}`,
          command: null,
        });
      } finally {
        inFlight.current.delete(id);
      }
    },
    [onToast, queryClient],
  );

  const kill = useProcessKill(handleKill);

  // Disarm when the armed row's target changed, vanished or got locked.
  useEffect(() => {
    const armed = kill.armed;
    if (!armed) return;
    const row = rows.find((r) => r.key === armed.key);
    if (
      !row ||
      !row.killable ||
      row.target?.pid !== armed.pid ||
      row.target?.startedAt !== armed.startedAt
    ) {
      kill.disarm();
    }
  }, [rows, kill]);

  return kill;
}
