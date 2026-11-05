import { ThermalChart, bandColor } from "@/components/ThermalChart";
import { useThermalCurrent, useThermalToday } from "@/hooks/use-thermal";
import {
  BAND_COPY,
  STATE_COPY,
  baselineDelta,
  formatClock,
  formatTemp,
  summarize,
} from "@/lib/thermal";
import type { ThermalHistory, ThermalPeak, ThermalReading } from "@/lib/types";
import styles from "./thermal-panel.module.css";

const MAX_PEAKS = 3;
const MAX_PROCESSES = 3;

interface Props {
  /** Switches to Ports with the search set to this port. */
  onShowPort: (port: number) => void;
}

/** The panel's Thermal tab: the reading, today's chart and today's peaks.
 * Owns its polling, so it only calls Rust while it is mounted. */
export function ThermalPanel({ onShowPort }: Props) {
  const current = useThermalCurrent();
  const today = useThermalToday();

  return (
    <div className={styles.root}>
      <div className={styles.scroll}>
        <Current reading={current.data} />
        <History history={today.data} fetchedAt={today.dataUpdatedAt} onShowPort={onShowPort} />
      </div>
    </div>
  );
}

function Current({ reading }: { reading: ThermalReading | null | undefined }) {
  if (reading === undefined) return <p className={styles.quiet}>Reading sensors…</p>;
  if (reading === null) {
    return <p className={styles.quiet}>Temperature sensors are not available on this Mac.</p>;
  }
  const delta = baselineDelta(reading);
  return (
    <section className={styles.current} aria-label="Current temperature">
      <div className={styles.reading} style={{ color: bandColor(reading.band) }}>
        {formatTemp(reading.avgC)}
      </div>
      <div className={styles.currentText}>
        <div className={styles.bandCopy}>{BAND_COPY[reading.band]}</div>
        <div className={styles.stateCopy}>{STATE_COPY[reading.state]}</div>
        {delta ? <div className={styles.delta}>{delta}</div> : null}
      </div>
    </section>
  );
}

function History({
  history,
  fetchedAt,
  onShowPort,
}: {
  history: ThermalHistory | undefined;
  fetchedAt: number;
  onShowPort: (port: number) => void;
}) {
  if (history === undefined) return null;
  if (!history.available) return <p className={styles.quiet}>History is unavailable right now.</p>;
  const stats = summarize(history.buckets);
  // Rust returns peaks newest first; the panel keeps the most recent ones.
  const peaks = history.peaks.slice(0, MAX_PEAKS);
  return (
    <>
      <section className={styles.section}>
        <h2 className={styles.heading}>Today</h2>
        {history.buckets.length > 0 ? (
          <ThermalChart buckets={history.buckets} now={new Date(fetchedAt)} compact />
        ) : (
          <p className={styles.empty}>Nothing recorded yet today.</p>
        )}
        {stats ? (
          <p className={styles.stats}>
            <span>Min {formatTemp(stats.min)}</span>
            <span>Avg {formatTemp(stats.avg)}</span>
            <span>Max {formatTemp(stats.max)}</span>
          </p>
        ) : null}
      </section>
      <section className={styles.section}>
        <h2 className={styles.heading}>Peaks today</h2>
        {peaks.length === 0 ? (
          <p className={styles.empty}>No peaks today.</p>
        ) : (
          peaks.map((peak) => <Peak key={peak.id} peak={peak} onShowPort={onShowPort} />)
        )}
      </section>
    </>
  );
}

function Peak({ peak, onShowPort }: { peak: ThermalPeak; onShowPort: (port: number) => void }) {
  return (
    <div className={styles.peak}>
      <div className={styles.peakHead}>
        <span className={styles.when}>{formatClock(peak.atS)}</span>
        <span className={styles.peakTemp}>{formatTemp(peak.avgC)}</span>
      </div>
      <ul className={styles.processes}>
        {peak.processes.slice(0, MAX_PROCESSES).map((p) => (
          <li key={p.pid} className={styles.process}>
            <span className={styles.processName}>{p.name}</span>
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
          </li>
        ))}
      </ul>
    </div>
  );
}
