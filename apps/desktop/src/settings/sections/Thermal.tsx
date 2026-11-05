import { useEffect, useRef, useState } from "react";
import {
  BAND_COPY,
  STATE_COPY,
  baselineDelta,
  formatClock,
  formatDay,
  formatTemp,
  summarize,
  thermalCurrent,
  thermalHistory,
  todayRange,
} from "../../lib/thermal";
import type { ThermalHistory, ThermalPeak, ThermalReading } from "../../lib/types";
import { ThermalChart, bandColor } from "../../components/ThermalChart";
import { useSetting } from "../store";
import { Group, Pill, Row, SectionHeading, Switch } from "../ui";
import styles from "./thermal.module.css";

const CURRENT_EVERY_MS = 10_000;
const HISTORY_EVERY_MS = 60_000;
const HISTORY_DAYS = 7;

/**
 * Runs `load` now and every `intervalMs` while mounted and visible. The
 * Settings window has no QueryClientProvider (the panel owns react-query),
 * so this follows the plain-effect polling of Settings > Ports. A failed
 * call keeps the last value; `undefined` means "not loaded yet".
 */
function usePolled<T>(load: () => Promise<T>, intervalMs: number): T | undefined {
  const [value, setValue] = useState<T | undefined>(undefined);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let alive = true;
    const refresh = () => {
      if (document.hidden) return;
      loadRef.current().then(
        (next) => alive && setValue(next),
        () => {},
      );
    };
    refresh();
    const timer = setInterval(refresh, intervalMs);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [intervalMs]);

  return value;
}

export default function Thermal() {
  const [guardEnabled, setGuardEnabled] = useSetting("thermalGuardEnabled");
  const [showInPanel, setShowInPanel] = useSetting("showTemperatureInPanel");
  // `null` is a loaded "no sensor"; `undefined` is still loading.
  const reading = usePolled(thermalCurrent, CURRENT_EVERY_MS);
  const history = usePolled(() => {
    const { fromS, toS } = todayRange(new Date());
    return thermalHistory(fromS, toS, HISTORY_DAYS);
  }, HISTORY_EVERY_MS);

  return (
    <>
      <Current reading={reading} />
      <History history={history} />
      <SectionHeading>Guard</SectionHeading>
      <Group>
        <Row
          label="Record temperature in the background"
          reason="Every minute, also with the panel closed. Kept for 90 days on this Mac."
          control={
            <Switch
              label="Record temperature in the background"
              checked={guardEnabled}
              onChange={setGuardEnabled}
            />
          }
        />
        <Row
          label="Show temperature in the panel"
          reason="On the panel's Thermal tab label."
          control={
            <Switch
              label="Show temperature in the panel"
              checked={showInPanel}
              onChange={setShowInPanel}
            />
          }
        />
      </Group>
    </>
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
      <p className={styles.note}>
        Bands are community-reported; the pressure line comes from macOS.
      </p>
    </section>
  );
}

function History({ history }: { history: ThermalHistory | undefined }) {
  if (history === undefined) return null;
  if (!history.available) return <p className={styles.quiet}>History is unavailable right now.</p>;
  const stats = summarize(history.buckets);
  return (
    <>
      <SectionHeading>Today</SectionHeading>
      <Group>
        <div className={styles.todayBody}>
          {history.buckets.length > 0 ? (
            <ThermalChart buckets={history.buckets} now={new Date()} />
          ) : (
            <p className={styles.empty}>Nothing recorded yet today.</p>
          )}
          {stats ? (
            <dl className={styles.stats}>
              <Stat label="Min" value={stats.min} />
              <Stat label="Avg" value={stats.avg} />
              <Stat label="Max" value={stats.max} />
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
                {formatTemp(d.minC)} · {formatTemp(d.avgC)} · {formatTemp(d.maxC)}
              </span>
              {d.seriousMinutes > 0 ? (
                <span className={styles.serious}>{d.seriousMinutes} min under pressure</span>
              ) : null}
            </div>
          ))
        )}
      </Group>

      <SectionHeading>Peaks</SectionHeading>
      <Group>
        {history.peaks.length === 0 ? (
          <p className={styles.empty}>No peaks today.</p>
        ) : (
          history.peaks.map((peak) => <Peak key={peak.id} peak={peak} />)
        )}
      </Group>
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className={styles.stat}>
      <dt>{label}</dt>
      <dd>{formatTemp(value)}</dd>
    </div>
  );
}

function Peak({ peak }: { peak: ThermalPeak }) {
  return (
    <div className={styles.peak}>
      <div className={styles.peakHead}>
        <span className={styles.when}>{formatClock(peak.atS)}</span>
        <span className={styles.peakTemp}>{formatTemp(peak.avgC)}</span>
        <span className={styles.peakMax}>hottest sensor {formatTemp(peak.maxC)}</span>
      </div>
      <ul className={styles.processes}>
        {peak.processes.map((p) => (
          <li key={p.pid} className={styles.process}>
            <span className={styles.processName}>{p.name}</span>
            <span className={styles.cpu}>{Math.round(p.cpu)}% CPU</span>
            {p.ports.map((port) => (
              <Pill key={port}>{port}</Pill>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}
