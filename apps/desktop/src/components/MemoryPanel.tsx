import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CommandCard } from "@/components/CommandCard";
import { MemoryChart } from "@/components/MemoryChart";
import { useMemoryCurrent, useMemoryToday } from "@/hooks/use-memory";
import { useKillConfirm } from "@/hooks/use-kill-confirm";
import {
  PRESSURE_COPY,
  PROTECTED_COPY,
  SIGNAL_COPY,
  VERDICT_COPY,
  VERDICT_LABEL,
  formatBytes,
  groupProcesses,
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

/** The panel's Memory tab: the verdict, the figures, the processes
 * (yours, then protected) and today's chart. Owns its polling, so it only calls Rust while it is
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
    const live = reading?.processes.find(
      (p) => p.pid === entry.pid && p.startedAt === entry.startedAt,
    );
    if (!live || !live.killable) return;
    void handleKill(toKillTarget(live));
  });

  // Disarm when the armed process is gone, was replaced, or lost killability.
  useEffect(() => {
    const armed = confirm.armedTarget;
    if (!armed) return;
    const stillThere = reading?.processes.some((p) => processKey(p) === armed.key && p.killable);
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
            reading={reading}
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

/** The first read runs `top` when its snapshot is stale, so the tab can take
 * about a second to fill. The skeleton keeps the layout (verdict line,
 * figures, a few rows) so nothing jumps when the reading lands. */
function Skeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Reading memory" className={styles.skeleton}>
      <section className={styles.current}>
        <div className={styles.verdictLine}>
          <span className={`${styles.bone} ${styles.bonePill}`} />
          <span className={`${styles.bone} ${styles.boneText}`} />
        </div>
        <dl className={styles.figures}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={styles.figure}>
              <dt>
                <span className={`${styles.bone} ${styles.boneLabel}`} />
              </dt>
              <dd>
                <span className={`${styles.bone} ${styles.boneValue}`} />
              </dd>
            </div>
          ))}
        </dl>
      </section>
      <section className={styles.section}>
        <h3 className={styles.heading}>Biggest processes</h3>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={styles.boneRow}>
            <span className={`${styles.bone} ${styles.boneName}`} />
            <span className={`${styles.bone} ${styles.boneSize}`} />
          </div>
        ))}
      </section>
    </div>
  );
}

function Current({ reading }: { reading: MemoryReading | null | undefined }) {
  if (reading === undefined) return <Skeleton />;
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
  reading,
  armedKey,
  onRequestKill,
  onDisarm,
  onShowPort,
}: {
  reading: MemoryReading;
  armedKey: string | null;
  onRequestKill: (p: MemoryProcess) => void;
  onDisarm: () => void;
  onShowPort: (port: number) => void;
}) {
  // Open state lives here only: it resets when the tab is left.
  const [protectedOpen, setProtectedOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const groups = groupProcesses(reading.processes, showAll);
  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Yours</h2>
      {groups.yours.length === 0 ? (
        <p className={styles.empty}>No processes to show.</p>
      ) : (
        <ul className={styles.processes}>
          {groups.yours.map((p) => (
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
      {groups.protectedCount > 0 ? (
        <>
          <button
            type="button"
            className={styles.groupToggle}
            aria-expanded={protectedOpen}
            onClick={() => setProtectedOpen((open) => !open)}
          >
            <span aria-hidden="true">{protectedOpen ? "▾" : "▸"}</span>
            {` Protected · ${groups.protectedCount} ${
              groups.protectedCount === 1 ? "process" : "processes"
            } · ${formatBytes(groups.protectedBytes)}`}
          </button>
          {protectedOpen ? (
            <ul className={styles.processes}>
              {groups.protectedRows.map((p) => (
                <ProtectedProcess key={processKey(p)} process={p} onShowPort={onShowPort} />
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
      {groups.smallCount > 0 || showAll ? (
        <p className={styles.footerLine}>
          {groups.smallCount} smaller {groups.smallCount === 1 ? "process" : "processes"} ·{" "}
          {formatBytes(groups.smallBytes)}
          <button
            type="button"
            className={styles.linkButton}
            onClick={() => setShowAll((all) => !all)}
          >
            {showAll ? "Show fewer" : "Show all"}
          </button>
        </p>
      ) : null}
      {reading.unattributedBytes > 0 ? (
        <p
          className={styles.footerLine}
          title="Kernel memory, compressed pages and processes chapay cannot read"
        >
          Not attributed to a process · {formatBytes(reading.unattributedBytes)}
        </p>
      ) : null}
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
  return (
    <li className={styles.process}>
      <div className={styles.processHead}>
        <span className={styles.processName}>{p.name}</span>
        <span className={styles.footprint}>{formatBytes(p.footprintBytes)}</span>
        <button
          type="button"
          className={armed ? styles.killArmed : styles.kill}
          aria-label={`Kill ${p.name} (${p.pid})`}
          onClick={onRequestKill}
          onMouseLeave={onDisarm}
        >
          {armed ? "Kill?" : "Kill"}
        </button>
      </div>
      <ProcessMeta process={p} onShowPort={onShowPort} />
    </li>
  );
}

/** A row without Kill: muted, with the reason on one line. Only a row that
 * has a command (another user's non-Apple process) can open the card. */
function ProtectedProcess({
  process: p,
  onShowPort,
}: {
  process: MemoryProcess;
  onShowPort: (port: number) => void;
}) {
  const [showCommand, setShowCommand] = useState(false);
  return (
    <li className={`${styles.process} ${styles.protectedRow}`}>
      <div className={styles.processHead}>
        <span className={styles.processName}>{p.name}</span>
        <span className={styles.footprint}>{formatBytes(p.footprintBytes)}</span>
      </div>
      <div className={styles.reasonLine}>
        <span className={styles.reasonText}>
          {p.protectedReason ? PROTECTED_COPY[p.protectedReason] : ""}
        </span>
        {p.command ? (
          <button
            type="button"
            className={styles.linkButton}
            aria-expanded={showCommand}
            aria-label={`Show command for ${p.name}`}
            onClick={() => setShowCommand((open) => !open)}
          >
            {showCommand ? "Hide command" : "Show command"}
          </button>
        ) : null}
      </div>
      <ProcessMeta process={p} onShowPort={onShowPort} />
      {showCommand && p.command ? <CommandCard command={p.command} /> : null}
    </li>
  );
}

function ProcessMeta({
  process: p,
  onShowPort,
}: {
  process: MemoryProcess;
  onShowPort: (port: number) => void;
}) {
  const growth = p.flags.includes("growing") ? growthLabel(p, formatClock) : null;
  const big = p.flags.includes("bigProcess");
  if (!big && !p.flags.includes("growing") && p.ports.length === 0) return null;
  return (
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
