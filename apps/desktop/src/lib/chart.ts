import type { SeriesDto } from "@/lib/machine-types";
import type { SeriesPoint } from "@/lib/sparkline";

/** A gap opens between two sampled slots more than `max(3 x bucket, 5 s)` apart. */
export function gapMsFor(bucketMs: number): number {
  return Math.max(3 * bucketMs, 5000);
}

/** The chart's samples: one point per sampled bucket (its average), at the bucket's end. */
export function seriesPoints(series: SeriesDto): SeriesPoint[] {
  return series.buckets.flatMap((b) => (b ? [{ atMs: b.tMs, value: b.avg }] : []));
}

export interface Gap {
  fromMs: number;
  toMs: number;
}

/** Spans with no samples that are wider than the gap rule, including the start and end of the
 * window. Drawn as "not sampled"; never as zero and never as a line across. */
export function findGaps(series: SeriesDto): Gap[] {
  const gapMs = gapMsFor(series.bucketMs);
  const startMs = series.endMs - series.bucketMs * series.buckets.length;
  const times = series.buckets.flatMap((b) => (b ? [b.tMs] : []));
  const gaps: Gap[] = [];
  let prev = startMs;
  for (const t of times) {
    if (t - prev > gapMs) gaps.push({ fromMs: prev, toMs: t });
    prev = t;
  }
  if (series.endMs - prev > gapMs) gaps.push({ fromMs: prev, toMs: series.endMs });
  return gaps;
}

/** Closes a polyline into an area down to the chart's baseline. */
export function areaPath(points: string, h: number): string | null {
  const pts = points.split(" ").filter(Boolean);
  if (pts.length < 2) return null;
  const first = pts[0]!.split(",")[0];
  const last = pts[pts.length - 1]!.split(",")[0];
  return `M${pts.join(" L")} L${last},${h} L${first},${h} Z`;
}

/** "14:02" in local time. */
export function clock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const THERMAL_WORDS = ["Nominal", "Fair", "Serious", "Critical"];

export function formatChartValue(value: number, unit: "%" | "°C" | "level"): string {
  if (unit === "level") return THERMAL_WORDS[Math.min(3, Math.max(0, Math.round(value)))]!;
  if (unit === "°C") return `${Math.round(value)} °C`;
  return `${Math.round(value)} %`;
}

/** One sentence for screen readers: the figures a sighted user reads off the chart. */
export function describeSeries(series: SeriesDto, unit: "%" | "°C" | "level"): string {
  const avgs = series.buckets.flatMap((b) => (b ? [b.avg] : []));
  if (avgs.length === 0) return "No samples in this range.";
  const peak = series.peak;
  const parts = [
    `${formatChartValue(Math.min(...avgs), unit)} to ${formatChartValue(Math.max(...avgs), unit)}`,
  ];
  if (peak) {
    parts.push(
      `peak ${formatChartValue(peak.value, unit)} at ${clock(peak.tMs)}${
        peak.top ? ` · ${peak.top.name}` : ""
      }`,
    );
  }
  const gaps = findGaps(series).length;
  if (gaps > 0) parts.push(`${gaps} span${gaps === 1 ? "" : "s"} not sampled`);
  return parts.join(", ");
}
