import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CommandCard } from "@/components/CommandCard";
import { MemoryChart } from "@/components/MemoryChart";
import { useMemoryCurrent, useMemoryToday } from "@/hooks/use-memory";
import { useKillConfirm } from "@/hooks/use-kill-confirm";
import {
  PRESSURE_COPY,
  SIGNAL_COPY,
  VERDICT_COPY,
  VERDICT_LABEL,
  formatBytes,
  growthLabel,
  killProcess,
  processKey,
  summarizeBuckets,
  swapPercent,
  toKillTarget,
  verdictColor,
} from "@/lib/memory";
import { killPort } from "@/lib/ports";
import { formatClock } from "@/lib/thermal";
import type { MemoryHistory, MemoryProcess, MemoryReading, PortEntry } from "@/lib/types";
import styles from "./memory-panel.module.css";

interface Props {
  /** Switches to Ports with the search set to this port. */
  onShowPort: (port: number) => void;
  /** Reports the outcome of a kill (the panel's toast). */
  onNotify: (message: string) => void;
}

/** The panel's Memory tab: the verdict, the figures, the biggest processes
 * and today's chart. Owns its polling, so it only calls Rust while it is
 * mounted. */
export function MemoryPanel({ onShowPort, onNotify }: Props) {
  const queryClient = useQueryClient();
  const current = useMemoryCurrent();
  const today = useMemoryToday();
  const reading = current.data;

  async function handleKill(entry: PortEntry) {
    try {
      // A row with a port goes through the Ports kill; otherwise by pid.
      const result =
        entry.port > 0 ? await killPort(entry) : await killProcess(entry.pid, entry.startedAt);
      if (result === "terminated" || result === "killed") {
        onNotify(`${entry.label} stopped`);
      } else if (result === "alreadyGone") {
        onNotify(`${entry.label} was already gone`);
      } else {
        onNotify(`Cannot kill ${entry.label}`);
      }
      void queryClient.invalidateQueries({ queryKey: ["memory", "current"] });
    } catch (err) {
      onNotify(`Could not kill ${entry.label}: ${String(err)}`);
    }
  }

  // Memory rows always take the two-step confirmation (category "app").
  const confirm = useKillConfirm((entry) => {
    // Re-validate against the latest reading right before executing.
    const live = reading?.top.find((p) => p.pid === entry.pid && p.startedAt === entry.startedAt);
    if (!live || !live.killable) return;
    void handleKill(toKillTarget(live));
  });

  // Disarm when the armed process is gone, was replaced, or lost killability.
  useEffect(() => {
    const armed = confirm.armedTarget;
    if (!armed) return;
    const stillThere = reading?.top.some((p) => processKey(p) === armed.key && p.killable);
    if (!stillThere) confirm.disarm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reading, confirm.armedTarget]);

  // Losing window focus disarms the confirmation, as on the Ports tab.
  useEffect(() => {
    const onBlur = () => confirm.disarm();
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={styles.root}>
      <div className={styles.scroll}>
        <Current reading={reading} />
        {reading ? (
          <Processes
            processes={reading.top}
            armedKey={confirm.armedTarget?.key ?? null}
            onRequestKill={(p) => confirm.request(toKillTarget(p), "pointer", processKey(p))}
            onDisarm={confirm.disarm}
            onShowPort={onShowPort}
          />
        ) : null}
        <History history={today.data} fetchedAt={today.dataUpdatedAt} />
      </div>
    </div>
  );
}

function Current({ reading }: { reading: MemoryReading | null | undefined }) {
  if (reading === undefined) return <p className={styles.quiet}>Reading memory…</p>;
  if (reading === null) return <p className={styles.quiet}>Memory figures are unavailable.</p>;
  return (
    <section className={styles.current} aria-label="Current memory">
      <div className={styles.verdictLine}>
        <span
          className={styles.verdictPill}
          style={{
            color: verdictColor(reading.verdict),
            borderColor: verdictColor(reading.verdict),
          }}
        >
          {VERDICT_LABEL[reading.verdict]}
        </span>
        <span className={styles.verdictCopy}>{VERDICT_COPY[reading.verdict]}</span>
      </div>
      {reading.reasons.length > 0 ? (
        <p className={styles.reasons}>{reading.reasons.map((r) => SIGNAL_COPY[r]).join(" · ")}</p>
      ) : null}
      <dl className={styles.figures}>
        <Figure
          label="Used"
          value={`${formatBytes(reading.usedBytes)} of ${formatBytes(reading.totalBytes)}`}
        />
        <Figure
          label="Swap"
          value={`${formatBytes(reading.swapUsedBytes)} of ${formatBytes(reading.swapTotalBytes)}${
            reading.swapTotalBytes > 0 ? ` (${swapPercent(reading)}%)` : ""
          }`}
        />
        <Figure label="Compressed" value={formatBytes(reading.compressedBytes)} />
        <Figure label="Pressure" value={PRESSURE_COPY[reading.pressure]} />
      </dl>
    </section>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.figure}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Processes({
  processes,
  armedKey,
  onRequestKill,
  onDisarm,
  onShowPort,
}: {
  processes: MemoryProcess[];
  armedKey: string | null;
  onRequestKill: (p: MemoryProcess) => void;
  onDisarm: () => void;
  onShowPort: (port: number) => void;
}) {
  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Biggest processes</h2>
      {processes.length === 0 ? (
        <p className={styles.empty}>No processes to show.</p>
      ) : (
        <ul className={styles.processes}>
          {processes.map((p) => (
            <Process
              key={processKey(p)}
              process={p}
              armed={armedKey === processKey(p)}
              onRequestKill={() => onRequestKill(p)}
              onDisarm={onDisarm}
              onShowPort={onShowPort}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function Process({
  process: p,
  armed,
  onRequestKill,
  onDisarm,
  onShowPort,
}: {
  process: MemoryProcess;
  armed: boolean;
  onRequestKill: () => void;
  onDisarm: () => void;
  onShowPort: (port: number) => void;
}) {
  const growth = p.flags.includes("growing") ? growthLabel(p, formatClock) : null;
  const big = p.flags.includes("bigProcess");
  return (
    <li className={styles.process}>
      <div className={styles.processHead}>
        <span className={styles.processName}>{p.name}</span>
        <span className={styles.footprint}>{formatBytes(p.footprintBytes)}</span>
        {p.killable ? (
          <button
            type="button"
            className={armed ? styles.killArmed : styles.kill}
            aria-label={`Kill ${p.name} (${p.pid})`}
            onClick={onRequestKill}
            onMouseLeave={onDisarm}
          >
            {armed ? "Kill?" : "Kill"}
          </button>
        ) : null}
      </div>
      {big || p.flags.includes("growing") || p.ports.length > 0 ? (
        <div className={styles.meta}>
          {big ? <span className={styles.flag}>big</span> : null}
          {p.flags.includes("growing") ? (
            <span className={styles.flag}>{growth ?? "growing"}</span>
          ) : null}
          {p.ports.map((port) => (
            <button
              key={port}
              type="button"
              className={styles.portPill}
              aria-label={`Show port ${port}`}
              onClick={() => onShowPort(port)}
            >
              {port}
            </button>
          ))}
        </div>
      ) : null}
      {!p.killable && p.command ? <CommandCard command={p.command} /> : null}
    </li>
  );
}

function History({
  history,
  fetchedAt,
}: {
  history: MemoryHistory | undefined;
  fetchedAt: number;
}) {
  if (history === undefined) return null;
  if (!history.available) return <p className={styles.quiet}>History is unavailable right now.</p>;
  const stats = summarizeBuckets(history.buckets);
  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Today</h2>
      {history.buckets.length > 0 ? (
        <MemoryChart buckets={history.buckets} now={new Date(fetchedAt)} compact />
      ) : (
        <p className={styles.empty}>Nothing recorded yet today.</p>
      )}
      {stats ? (
        <p className={styles.stats}>
          <span>Peak used {formatBytes(stats.usedMax)}</span>
          <span>Peak swap {formatBytes(stats.swapMax)}</span>
        </p>
      ) : null}
    </section>
  );
}
