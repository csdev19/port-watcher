import type { GaugeDto, HistoryPoint } from "@/lib/machine-types";

export interface SeriesPoint {
  atMs: number;
  value: number | null;
}

export interface PolylineOptions {
  nowMs: number;
  /** Width of the time axis, 60 000 for the last minute. */
  windowMs: number;
  min: number;
  max: number;
  w: number;
  h: number;
  /** A larger gap between two points splits the line, so a hidden panel is never drawn as a
   * straight line across the missing time. */
  gapMs: number;
  /** Vertical inset so a line at the extremes is not clipped. */
  pad?: number;
}

const round = (n: number) => Math.round(n * 10) / 10;

/** Vertical position of `value` on a chart of height `h`, clamped to the chart. */
export function lineY(
  value: number,
  o: Pick<PolylineOptions, "min" | "max" | "h" | "pad">,
): number {
  const pad = o.pad ?? 1.5;
  const span = o.max - o.min || 1;
  const t = Math.min(1, Math.max(0, (value - o.min) / span));
  return round(o.h - pad - t * (o.h - 2 * pad));
}

/** `points` attribute strings, one per continuous segment. The x axis is time: the newest
 * point can sit at the right edge only if it is `nowMs`. Points older than the window and
 * null values are dropped (a null also splits the line). */
export function toPolylines(points: SeriesPoint[], o: PolylineOptions): string[] {
  const lines: string[] = [];
  let current: string[] = [];
  let lastAt: number | null = null;
  const flush = () => {
    if (current.length > 0) lines.push(current.join(" "));
    current = [];
  };
  for (const p of [...points].sort((a, b) => a.atMs - b.atMs)) {
    if (p.atMs < o.nowMs - o.windowMs || p.atMs > o.nowMs) continue;
    if (p.value === null) {
      flush();
      lastAt = null;
      continue;
    }
    if (lastAt !== null && p.atMs - lastAt > o.gapMs) flush();
    const x = round(o.w - ((o.nowMs - p.atMs) / o.windowMs) * o.w);
    current.push(`${x},${lineY(p.value, o)}`);
    lastAt = p.atMs;
  }
  flush();
  return lines;
}

/** The series a gauge draws: hotspot degrees for Heat (or pressure steps without a sensor). */
export function seriesFor(gauge: GaugeDto, history: HistoryPoint[]): SeriesPoint[] {
  return history.map((p) => {
    let value: number | null;
    switch (gauge.id) {
      case "cpu":
        value = p.cpu;
        break;
      case "gpu":
        value = p.gpu;
        break;
      case "heat":
        value = gauge.unit === "level" ? p.heatLevel : p.heat;
        break;
      case "memory":
        value = p.memUsedPct;
        break;
    }
    return { atMs: p.atMs, value };
  });
}

const PRESSURE_WORDS = ["nominal", "fair", "serious", "critical"];

/** One sentence for screen readers: "22 to 41 percent, rising". Empty when there is no data.
 * It changes only when its rounded text changes, so a live region would stay quiet. */
export function summarize(values: Array<number | null>, unit: GaugeDto["unit"]): string {
  const v = values.filter((x): x is number => x !== null);
  if (v.length < 2) return "";
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  const delta = v[v.length - 1]! - v[0]!;
  const step = unit === "level" ? 1 : unit === "°C" ? 3 : 5;
  const trend = delta >= step ? "rising" : delta <= -step ? "falling" : "steady";
  if (unit === "level") {
    const word = (n: number) => PRESSURE_WORDS[Math.min(3, Math.max(0, Math.round(n)))];
    return Math.round(lo) === Math.round(hi)
      ? `${word(lo)}, ${trend}`
      : `${word(lo)} to ${word(hi)}, ${trend}`;
  }
  const noun = unit === "°C" ? "degrees" : "percent";
  const a = Math.round(lo);
  const b = Math.round(hi);
  return a === b ? `${a} ${noun}, ${trend}` : `${a} to ${b} ${noun}, ${trend}`;
}
