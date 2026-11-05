import { BAND_EDGES, formatClock, todayRange } from "../lib/thermal";
import type { ThermalBand, ThermalBucket } from "../lib/types";
import styles from "./thermal-chart.module.css";

const PAD = { left: 30, right: 8, top: 8, bottom: 20 };
const Y_MIN = 30;
const Y_MAX = 110;
/** A gap this long between buckets (sleep, app off) breaks the line. */
const GAP_S = 600;

const BAND_ORDER: ThermalBand[] = ["cool", "normal", "warm", "hot", "throttling"];

export function bandColor(band: ThermalBand): string {
  return `var(--pw-band-${band})`;
}

interface Props {
  buckets: ThermalBucket[];
  now: Date;
  /** Drawing height in px; the width always fills the container. */
  height?: number;
  /** Panel width: fewer axis labels, no legend. */
  compact?: boolean;
}

export function ThermalChart({ buckets, now, height, compact = false }: Props) {
  // The viewBox is drawn at about one unit per pixel, so text keeps its size.
  const W = compact ? 316 : 560;
  const H = height ?? (compact ? 104 : 150);
  const fromS = todayRange(now).fromS;
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
  for (let h = 0; h < 24; h += compact ? 6 : 3) {
    const s = Math.floor(
      new Date(day.getFullYear(), day.getMonth(), day.getDate(), h).getTime() / 1000,
    );
    if (s <= toS) ticks.push(s);
  }
  const yLabels = BAND_EDGES.filter((c) => c <= (compact ? 70 : 90));

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
        {yLabels.map((c) => (
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
      {compact ? null : (
        <figcaption className={styles.legend}>
          <span className={styles.legendAvg}>Average</span>
          <span className={styles.legendMax}>Hottest sensor</span>
        </figcaption>
      )}
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
