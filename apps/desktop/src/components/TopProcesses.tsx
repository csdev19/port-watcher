import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTopProcesses } from "@/hooks/use-top-processes";
import { useProcessKill } from "@/hooks/use-process-kill";
import { killProcess } from "@/lib/machine";
import type { ProcessGroupDto } from "@/lib/machine-types";
import { ProcessRow } from "@/components/ProcessRow";
import type { ToastData } from "@/components/Toast";
import styles from "@/machine.module.css";

interface Props {
  cores: number;
  cpuWarn: number | null;
  onToast: (toast: ToastData) => void;
}

/** "Top by CPU": ↑/↓ move, ⌘⌫ arms then confirms (always two steps). Esc is handled by App
 * (it hides the panel on every tab).
 * The key listener lives here, so it exists only while the Machine tab is open. */
export function TopProcesses({ cores, cpuWarn, onToast }: Props) {
  const queryClient = useQueryClient();
  const { data: rows = [], error } = useTopProcesses(true);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const inFlight = useRef<Set<string>>(new Set());

  const latest = useRef({ rows, selectedKey });
  latest.current = { rows, selectedKey };

  const handleKill = useCallback(
    async (group: ProcessGroupDto) => {
      // Re-resolve from the freshest list: act only on the exact process the user armed.
      const current = latest.current.rows.find((r) => r.key === group.key);
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
        void queryClient.invalidateQueries({ queryKey: ["top"] });
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
  const killRef = useRef(kill);
  killRef.current = kill;

  // Disarm when the armed row's target changed, vanished or got locked, or selection left it.
  useEffect(() => {
    const armed = kill.armed;
    if (!armed) return;
    const row = rows.find((r) => r.key === armed.key);
    if (
      !row ||
      !row.killable ||
      row.target?.pid !== armed.pid ||
      row.target?.startedAt !== armed.startedAt ||
      selectedKey !== armed.key
    ) {
      kill.disarm();
    }
  }, [rows, selectedKey, kill]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.isComposing) return;
      const { rows: list, selectedKey: sel } = latest.current;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (list.length === 0) return;
        const i = list.findIndex((r) => r.key === sel);
        const next = Math.min(list.length - 1, Math.max(0, i + (e.key === "ArrowDown" ? 1 : -1)));
        setSelectedKey(list[next]!.key);
        return;
      }
      if (e.key === "Backspace" && e.metaKey) {
        e.preventDefault();
        if (e.repeat) return;
        const row = list.find((r) => r.key === sel);
        if (row) killRef.current.request(row);
      }
    }
    function onBlur() {
      killRef.current.disarm();
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  return (
    <section aria-label="Top by CPU">
      <h2 className={styles.sectionLabel}>Top by CPU</h2>
      {rows.length === 0 ? (
        <p className={styles.procEmpty}>
          {error ? `Could not read processes: ${String(error)}` : "collecting…"}
        </p>
      ) : (
        <ul className={styles.procList}>
          {rows.map((group) => (
            <ProcessRow
              key={group.key}
              group={group}
              cores={cores}
              cpuWarn={cpuWarn}
              selected={selectedKey === group.key}
              armed={kill.armed?.key === group.key}
              onSelect={() => setSelectedKey(group.key)}
              onRequestKill={() => {
                setSelectedKey(group.key);
                kill.request(group);
              }}
              onDisarm={kill.disarm}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
