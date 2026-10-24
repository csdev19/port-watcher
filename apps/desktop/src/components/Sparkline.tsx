import type { GaugeDto, HistoryPoint } from "@/lib/machine-types";
import { lineY, seriesFor, toPolylines } from "@/lib/sparkline";
import styles from "@/machine.module.css";

export const SPARK_W = 104;
export const SPARK_H = 28;
const WINDOW_MS = 60_000;

interface Props {
  gauge: GaugeDto;
  history: HistoryPoint[];
  /** The newest sample's time: it sits at the right edge. */
  nowMs: number;
}

/** The last 60 s with the warn and stop lines drawn in. Classes and SVG attributes only (the
 * production CSP blocks style strings). Decorative: the gauge's text carries the meaning. */
export function Sparkline({ gauge, history, nowMs }: Props) {
  const box = { min: gauge.min, max: gauge.max, h: SPARK_H };
  const lines = toPolylines(seriesFor(gauge, history), {
    ...box,
    nowMs,
    windowMs: WINDOW_MS,
    w: SPARK_W,
    gapMs: 2500,
  });
  const hasLine = (v: number | null): v is number => v !== null;
  return (
    <svg
      className={styles.spark}
      width={SPARK_W}
      height={SPARK_H}
      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
      aria-hidden="true"
      data-level={gauge.level}
    >
      {hasLine(gauge.warn) && (
        <line
          className={styles.sparkWarn}
          x1={0}
          x2={SPARK_W}
          y1={lineY(gauge.warn, box)}
          y2={lineY(gauge.warn, box)}
        />
      )}
      {hasLine(gauge.stop) && (
        <line
          className={styles.sparkStop}
          x1={0}
          x2={SPARK_W}
          y1={lineY(gauge.stop, box)}
          y2={lineY(gauge.stop, box)}
        />
      )}
      {lines.map((points, i) => (
        <polyline key={i} className={styles.sparkLine} points={points} />
      ))}
    </svg>
  );
}
