import { formatBytes } from "../lib/memory";
import { formatClock, todayRange } from "../lib/thermal";
import type { MemoryBucket } from "../lib/types";
import styles from "./thermal-chart.module.css";

const PAD = { left: 38, right: 8, top: 8, bottom: 20 };
/** A gap this long between buckets (sleep, app off) breaks the line. */
const GAP_S = 600;
const GIB = 1024 ** 3;

interface Props {
  buckets: MemoryBucket[];
  now: Date;
  /** Drawing height in px; the width always fills the container. */
  height?: number;
  /** Panel width: fewer axis labels, no legend. */
  compact?: boolean;
}

/** Today's used memory (solid) and swap (dashed) from the 5-minute buckets.
 * Same look as ThermalChart; the y axis is bytes from 0 to the day's peak. */
export function MemoryChart({ buckets, now, height, compact = false }: Props) {
  const W = compact ? 316 : 560;
  const H = height ?? (compact ? 104 : 150);
  const fromS = todayRange(now).fromS;
  const lastS = buckets[buckets.length - 1].startS + 300;
  const toS = Math.max(lastS, fromS + 3600);
  const peak = Math.max(...buckets.map((b) => Math.max(b.usedMaxBytes, b.swapMaxBytes)));
  const yMax = Math.max(GIB, Math.ceil(peak / GIB) * GIB);
  const x = (s: number) => PAD.left + ((s - fromS) / (toS - fromS)) * (W - PAD.left - PAD.right);
  const y = (bytes: number) =>
    PAD.top + (1 - Math.min(Math.max(bytes, 0), yMax) / yMax) * (H - PAD.top - PAD.bottom);

  const usedPath = linePath(buckets, (b) => b.usedAvgBytes, x, y);
  const swapPath = linePath(buckets, (b) => b.swapAvgBytes, x, y);

  const ticks: number[] = [];
  const day = new Date(fromS * 1000);
  for (let h = 0; h < 24; h += compact ? 6 : 3) {
    const s = Math.floor(
      new Date(day.getFullYear(), day.getMonth(), day.getDate(), h).getTime() / 1000,
    );
    if (s <= toS) ticks.push(s);
  }
  const yLabels = [0, yMax / 2, yMax];

  return (
    <figure className={styles.chart}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Memory today: used memory and swap">
        {yLabels.map((v) => (
          <text key={v} x={PAD.left - 6} y={y(v) + 3} textAnchor="end" className={styles.axis}>
            {formatBytes(v)}
          </text>
        ))}
        {ticks.map((s) => (
          <text key={s} x={x(s)} y={H - 5} textAnchor="middle" className={styles.axis}>
            {formatClock(s)}
          </text>
        ))}
        <path d={swapPath} className={styles.maxLine} />
        <path d={usedPath} className={styles.avgLine} />
      </svg>
      {compact ? null : (
        <figcaption className={styles.legend}>
          <span className={styles.legendAvg}>Used</span>
          <span className={styles.legendMax}>Swap</span>
        </figcaption>
      )}
    </figure>
  );
}

function linePath(
  buckets: MemoryBucket[],
  value: (b: MemoryBucket) => number,
  x: (s: number) => number,
  y: (bytes: number) => number,
): string {
  let d = "";
  for (let i = 0; i < buckets.length; i++) {
    const b = buckets[i];
    const prev = buckets[i - 1];
    const next = buckets[i + 1];
    const fromPrev = prev !== undefined && b.startS - prev.startS <= GAP_S;
    const toNext = next !== undefined && next.startS - b.startS <= GAP_S;
    d += `${fromPrev ? "L" : "M"}${x(b.startS + 150).toFixed(1)} ${y(value(b)).toFixed(1)}`;
    // A lone bucket would be a move with no line; a zero-length segment with a
    // round cap draws a dot.
    if (!fromPrev && !toNext) d += "h0.01";
  }
  return d;
}
