import { useEffect, useRef, useState } from "react";
import {
  BAND_COPY,
  BAND_EDGES,
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
import type {
  ThermalBand,
  ThermalBucket,
  ThermalHistory,
  ThermalPeak,
  ThermalReading,
} from "../../lib/types";
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
          reason="A small chip next to the tabs."
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
            <Chart buckets={history.buckets} />
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
          [...history.peaks].reverse().map((peak) => <Peak key={peak.id} peak={peak} />)
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

// --- Chart ---

const W = 560;
const H = 150;
const PAD = { left: 30, right: 8, top: 8, bottom: 20 };
const Y_MIN = 30;
const Y_MAX = 110;
/** A gap this long between buckets (sleep, app off) breaks the line. */
const GAP_S = 600;

const BAND_ORDER: ThermalBand[] = ["cool", "normal", "warm", "hot", "throttling"];

export function bandColor(band: ThermalBand): string {
  return `var(--pw-band-${band})`;
}

function Chart({ buckets }: { buckets: ThermalBucket[] }) {
  const fromS = todayRange(new Date()).fromS;
  const lastS = buckets[buckets.length - 1].startS + 300;
  const toS = Math.max(lastS, fromS + 3600);
  const x = (s: number) => PAD.left + ((s - fromS) / (toS - fromS)) * (W - PAD.left - PAD.right);
  const y = (c: number) =>
    PAD.top +
    (1 - (Math.min(Math.max(c, Y_MIN), Y_MAX) - Y_MIN) / (Y_MAX - Y_MIN)) *
      (H - PAD.top - PAD.bottom);

  const edges = [Y_MIN, ...BAND_EDGES, Y_MAX];
  const bands = BAND_ORDER.map((band, i) => ({ band, top: y(edges[i + 1]), bottom: y(edges[i]) }));
  const avgPath = linePath(buckets, (b) => b.avgC, x, y);
  const maxPath = linePath(buckets, (b) => b.maxC, x, y);

  const ticks: number[] = [];
  const day = new Date(fromS * 1000);
  for (let h = 0; h < 24; h += 3) {
    const s = Math.floor(
      new Date(day.getFullYear(), day.getMonth(), day.getDate(), h).getTime() / 1000,
    );
    if (s <= toS) ticks.push(s);
  }

  return (
    <figure className={styles.chart}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Temperature today: average and hottest sensor"
      >
        {bands.map(({ band, top, bottom }) => (
          <rect
            key={band}
            x={PAD.left}
            y={top}
            width={W - PAD.left - PAD.right}
            height={bottom - top}
            fill={bandColor(band)}
            opacity={0.06}
          />
        ))}
        {BAND_EDGES.filter((c) => c <= 90).map((c) => (
          <text key={c} x={PAD.left - 6} y={y(c) + 3} textAnchor="end" className={styles.axis}>
            {c}°
          </text>
        ))}
        {ticks.map((s) => (
          <text key={s} x={x(s)} y={H - 5} textAnchor="middle" className={styles.axis}>
            {formatClock(s)}
          </text>
        ))}
        <path d={maxPath} className={styles.maxLine} />
        <path d={avgPath} className={styles.avgLine} />
      </svg>
      <figcaption className={styles.legend}>
        <span className={styles.legendAvg}>Average</span>
        <span className={styles.legendMax}>Hottest sensor</span>
      </figcaption>
    </figure>
  );
}

function linePath(
  buckets: ThermalBucket[],
  value: (b: ThermalBucket) => number,
  x: (s: number) => number,
  y: (c: number) => number,
): string {
  let d = "";
  for (let i = 0; i < buckets.length; i++) {
    const b = buckets[i];
    const prev = buckets[i - 1];
    const next = buckets[i + 1];
    const fromPrev = prev !== undefined && b.startS - prev.startS <= GAP_S;
    const toNext = next !== undefined && next.startS - b.startS <= GAP_S;
    d += `${fromPrev ? "L" : "M"}${x(b.startS + 150).toFixed(1)} ${y(value(b)).toFixed(1)}`;
    // A bucket with no neighbour on either side would be a lone move, which
    // draws nothing; a zero-length segment with a round cap draws a dot.
    if (!fromPrev && !toNext) d += "h0.01";
  }
  return d;
}
