import { useEffect, useState } from "react";
import { MemoryChart } from "../../components/MemoryChart";
import {
  DEFAULT_THRESHOLDS,
  PRESSURE_COPY,
  SIGNAL_COPY,
  VERDICT_COPY,
  VERDICT_LABEL,
  formatBytes,
  growthLabel,
  memoryCurrent,
  memoryHistory,
  memoryThresholds,
  setMemoryThresholds,
  summarizeBuckets,
  swapPercent,
  verdictColor,
} from "../../lib/memory";
import { formatClock, formatDay, todayRange } from "../../lib/thermal";
import type {
  MemoryHistory,
  MemoryProcess,
  MemoryReading,
  MemoryThresholds,
} from "../../lib/types";
import { useSetting } from "../store";
import { Button, Group, Pill, Row, RowNote, SectionHeading, Switch } from "../ui";
import { usePolled } from "./Thermal";
import styles from "./memory.module.css";

const CURRENT_EVERY_MS = 10_000;
const HISTORY_EVERY_MS = 60_000;
const HISTORY_DAYS = 7;
const GIB = 1024 ** 3;

export default function Memory() {
  const [guardEnabled, setGuardEnabled] = useSetting("memoryGuardEnabled");
  // `null` is a loaded "unavailable"; `undefined` is still loading.
  const reading = usePolled(memoryCurrent, CURRENT_EVERY_MS);
  const history = usePolled(() => {
    const { fromS, toS } = todayRange(new Date());
    return memoryHistory(fromS, toS, HISTORY_DAYS);
  }, HISTORY_EVERY_MS);

  return (
    <>
      <Current reading={reading} />
      <History history={history} />
      <SectionHeading>Biggest processes now</SectionHeading>
      <Group>
        {reading ? (
          reading.top.map((p) => <Process key={`${p.pid}:${p.startedAt}`} process={p} />)
        ) : (
          <p className={styles.empty}>No reading yet.</p>
        )}
      </Group>
      <SectionHeading>Guard</SectionHeading>
      <Group>
        <Row
          label="Record memory in the background"
          reason="Every minute, also with the panel closed. Kept for 90 days on this Mac."
          control={
            <Switch
              label="Record memory in the background"
              checked={guardEnabled}
              onChange={setGuardEnabled}
            />
          }
        />
      </Group>
      <Thresholds />
    </>
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
      <dl className={styles.stats}>
        <Stat
          label="Used"
          value={`${formatBytes(reading.usedBytes)} of ${formatBytes(reading.totalBytes)}`}
        />
        <Stat
          label="Swap"
          value={`${formatBytes(reading.swapUsedBytes)} of ${formatBytes(reading.swapTotalBytes)}${
            reading.swapTotalBytes > 0 ? ` (${swapPercent(reading)}%)` : ""
          }`}
        />
        <Stat label="Compressed" value={formatBytes(reading.compressedBytes)} />
        <Stat label="Pressure" value={PRESSURE_COPY[reading.pressure]} />
      </dl>
    </section>
  );
}

function History({ history }: { history: MemoryHistory | undefined }) {
  if (history === undefined) return null;
  if (!history.available) return <p className={styles.quiet}>History is unavailable right now.</p>;
  const peak = summarizeBuckets(history.buckets);
  return (
    <>
      <SectionHeading>Today</SectionHeading>
      <Group>
        <div className={styles.todayBody}>
          {history.buckets.length > 0 ? (
            <MemoryChart buckets={history.buckets} now={new Date()} />
          ) : (
            <p className={styles.empty}>Nothing recorded yet today.</p>
          )}
          {peak ? (
            <dl className={styles.stats}>
              <Stat label="Peak used" value={formatBytes(peak.usedMax)} />
              <Stat label="Peak swap" value={formatBytes(peak.swapMax)} />
            </dl>
          ) : null}
        </div>
      </Group>

      <SectionHeading>Last 7 days</SectionHeading>
      <Group>
        {history.days.length === 0 ? (
          <p className={styles.empty}>No daily summaries yet.</p>
        ) : (
          [...history.days].reverse().map((d) => (
            <div key={d.day} className={styles.line}>
              <span className={styles.when}>{formatDay(d.day)}</span>
              <span className={styles.range}>
                Used {formatBytes(d.usedMaxBytes)} · Swap {formatBytes(d.swapMaxBytes)}
              </span>
              {d.warningMinutes > 0 ? (
                <span className={styles.warning}>{d.warningMinutes} min under pressure</span>
              ) : null}
            </div>
          ))
        )}
      </Group>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.stat}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Process({ process: p }: { process: MemoryProcess }) {
  const growth = p.flags.includes("growing") ? growthLabel(p, formatClock) : null;
  return (
    <div className={styles.process}>
      <span className={styles.processName}>{p.name}</span>
      <span className={styles.footprint}>{formatBytes(p.footprintBytes)}</span>
      {p.flags.includes("bigProcess") ? <Pill>big</Pill> : null}
      {p.flags.includes("growing") ? <Pill>{growth ?? "growing"}</Pill> : null}
      {p.ports.map((port) => (
        <Pill key={port}>{port}</Pill>
      ))}
    </div>
  );
}

type Field = {
  key: keyof MemoryThresholds;
  label: string;
  reason: string;
  unit: string;
  /** Stored value to what the input shows, and back. */
  toInput: (v: number) => number;
  fromInput: (v: number) => number;
  min: number;
  max: number;
  step: number;
};

const FIELDS: Field[] = [
  {
    key: "swapWatchPct",
    label: "Watch when swap is above",
    reason: "Share of swap in use that raises WATCH.",
    unit: "%",
    toInput: (v) => v,
    fromInput: (v) => v,
    min: 1,
    max: 100,
    step: 1,
  },
  {
    key: "swapStopPct",
    label: "Stop when swap is above",
    reason: "Raises STOP together with a big process.",
    unit: "%",
    toInput: (v) => v,
    fromInput: (v) => v,
    min: 1,
    max: 100,
    step: 1,
  },
  {
    key: "bigProcessPct",
    label: "A process is big above",
    reason: "Share of physical RAM held by one process.",
    unit: "% of RAM",
    toInput: (v) => v,
    fromInput: (v) => v,
    min: 1,
    max: 100,
    step: 1,
  },
  {
    key: "growthFactor",
    label: "A process is growing at",
    reason: "Times its first recorded footprint.",
    unit: "×",
    toInput: (v) => v,
    fromInput: (v) => v,
    min: 1.1,
    max: 100,
    step: 0.1,
  },
  {
    key: "growthMinBytes",
    label: "…and only above",
    reason: "A small process that doubles is not a problem.",
    unit: "GB",
    toInput: (v) => Math.round((v / GIB) * 10) / 10,
    fromInput: (v) => Math.round(v * GIB),
    min: 0.1,
    max: 1024,
    step: 0.5,
  },
];

/** The five verdict thresholds. Each field saves when it loses focus with a
 * valid value; an invalid one says why and keeps the stored value. */
function Thresholds() {
  const [saved, setSaved] = useState<MemoryThresholds | undefined>(undefined);
  const [drafts, setDrafts] = useState<Partial<Record<keyof MemoryThresholds, string>>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    memoryThresholds().then(
      (t) => alive && setSaved(t),
      () => alive && setSaved(DEFAULT_THRESHOLDS),
    );
    return () => {
      alive = false;
    };
  }, []);

  if (saved === undefined) return null;
  const current = saved;

  function save(next: MemoryThresholds) {
    setSaved(next);
    setDrafts({});
    setError(null);
    setMemoryThresholds(next).catch((e: unknown) => {
      setError(`Could not save the thresholds: ${String(e)}`);
    });
  }

  function commit(field: Field) {
    const text = drafts[field.key];
    if (text === undefined) return;
    const value = Number(text);
    if (text.trim() === "" || !Number.isFinite(value) || value < field.min || value > field.max) {
      setError(`${field.label}: enter a number from ${field.min} to ${field.max} ${field.unit}.`);
      setDrafts({});
      return;
    }
    const next = { ...current, [field.key]: field.fromInput(value) };
    if (next.swapStopPct < next.swapWatchPct) {
      setError("Stop swap level cannot be below the watch level.");
      setDrafts({});
      return;
    }
    save(next);
  }

  return (
    <>
      <SectionHeading>Thresholds</SectionHeading>
      <Group>
        {FIELDS.map((field) => (
          <Row
            key={field.key}
            label={field.label}
            reason={field.reason}
            control={
              <span className={styles.field}>
                <input
                  className={styles.input}
                  type="number"
                  inputMode="decimal"
                  aria-label={field.label}
                  min={field.min}
                  max={field.max}
                  step={field.step}
                  value={drafts[field.key] ?? String(field.toInput(current[field.key]))}
                  onChange={(e) => setDrafts({ ...drafts, [field.key]: e.target.value })}
                  onBlur={() => commit(field)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commit(field);
                  }}
                />
                <span className={styles.unit}>{field.unit}</span>
              </span>
            }
          />
        ))}
        {error ? <RowNote>{error}</RowNote> : null}
        <div className={styles.reset}>
          <Button onClick={() => save({ ...DEFAULT_THRESHOLDS })}>Reset to defaults</Button>
        </div>
      </Group>
    </>
  );
}
