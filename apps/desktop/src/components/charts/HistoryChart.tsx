import { useId, useMemo, useState } from "react";
import type { GaugeDto, Level, SeriesDto } from "@/lib/machine-types";
import { lineY, toPolylines } from "@/lib/sparkline";
import {
  areaPath,
  clock,
  describeSeries,
  findGaps,
  formatChartValue,
  gapMsFor,
  seriesPoints,
} from "@/lib/chart";
import styles from "./chart.module.css";

const VB_W = 640;
const VB_H = 214;
const LEFT = 38;
const TOP = 8;
const PLOT_W = VB_W - LEFT - 6;
const PLOT_H = 160;
const STRIP_Y = TOP + PLOT_H + 8;
const STRIP_H = 8;
const AXIS_Y = VB_H - 4;

const RANGE_WORDS = {
  "1m": "1 min ago",
  "10m": "10 min ago",
  "1h": "1 h ago",
} as const;
const LEVEL_FOR_THERMAL: Level[] = ["ok", "watch", "stop", "stop"];

interface Props {
  series: SeriesDto | undefined;
  /** The gauge this metric belongs to: axis limits, warn/stop lines and the colour level. */
  gauge: GaugeDto | undefined;
  /** Thermal pressure level over the same range: drawn as a strip under the plot (Heat). */
  strip?: SeriesDto;
  /** Name the heaviest process at the peak. True for CPU and Heat, where it explains the peak. */
  showCulprit: boolean;
  label: string;
}

/** Hand-rolled SVG history chart. Sampled buckets draw as an area plus line; spans chapay did
 * not sample break the line and read "not sampled". Colours come from classes and attributes
 * only (the production CSP blocks style strings). */
export function HistoryChart({ series, gauge, strip, showCulprit, label }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const clipId = useId();
  const unit = gauge?.unit ?? "%";
  const min = gauge?.min ?? 0;
  const max = gauge?.max ?? 100;
  const level: Level = gauge?.level ?? "ok";

  const geometry = useMemo(() => {
    if (!series) return null;
    const windowMs = series.bucketMs * series.buckets.length;
    const lines = toPolylines(seriesPoints(series), {
      nowMs: series.endMs,
      windowMs,
      min,
      max,
      w: PLOT_W,
      h: PLOT_H,
      gapMs: gapMsFor(series.bucketMs),
    });
    return { windowMs, lines, gaps: findGaps(series) };
  }, [series, min, max]);

  if (!series || !geometry) {
    return (
      <div className={styles.empty} role="status">
        Reading history…
      </div>
    );
  }

  const { windowMs, lines, gaps } = geometry;
  const startMs = series.endMs - windowMs;
  const xOf = (ms: number) => ((ms - startMs) / windowMs) * PLOT_W;
  const y = (v: number) => lineY(v, { min, max, h: PLOT_H });
  const warn = gauge?.warn ?? null;
  const stop = gauge?.stop ?? null;
  const hasData = series.buckets.some((b) => b !== null);

  const hovered = hover !== null ? series.buckets[hover] : null;

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || !series) return;
    const px = ((e.clientX - rect.left) / rect.width) * VB_W - LEFT;
    const i = Math.round((px / PLOT_W) * series.buckets.length - 0.5);
    const clamped = Math.min(series.buckets.length - 1, Math.max(0, i));
    setHover(series.buckets[clamped] ? clamped : null);
  }

  const peak = series.peak;
  const peakX = peak ? xOf(peak.tMs) : 0;
  const peakLabel = peak
    ? `peak ${formatChartValue(peak.value, unit)} at ${clock(peak.tMs)}${
        showCulprit && peak.top ? ` · ${peak.top.name}` : ""
      }`
    : "";

  return (
    <svg
      className={styles.chart}
      data-level={level}
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      role="img"
      aria-label={`${label}: ${describeSeries(series, unit)}`}
      onMouseMove={onMove}
      onMouseLeave={() => setHover(null)}
    >
      <defs>
        <clipPath id={clipId}>
          <rect x={0} y={0} width={PLOT_W} height={PLOT_H} />
        </clipPath>
      </defs>
      <g transform={`translate(${LEFT} ${TOP})`}>
        <rect className={styles.plot} x={0} y={0} width={PLOT_W} height={PLOT_H} />
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line
              className={styles.grid}
              x1={0}
              x2={PLOT_W}
              y1={y(min + t * (max - min))}
              y2={y(min + t * (max - min))}
            />
            <text className={styles.tick} x={-6} y={y(min + t * (max - min)) + 3} textAnchor="end">
              {unit === "level"
                ? formatChartValue(min + t * (max - min), unit)
                : Math.round(min + t * (max - min))}
            </text>
          </g>
        ))}
        {warn !== null && stop !== null && (
          <rect
            className={styles.warnBand}
            x={0}
            width={PLOT_W}
            y={y(stop)}
            height={Math.max(0, y(warn) - y(stop))}
          />
        )}
        {stop !== null && (
          <>
            <rect
              className={styles.stopBand}
              x={0}
              width={PLOT_W}
              y={0}
              height={Math.max(0, y(stop))}
            />
            <line className={styles.stopLine} x1={0} x2={PLOT_W} y1={y(stop)} y2={y(stop)} />
          </>
        )}
        {warn !== null && (
          <line className={styles.warnLine} x1={0} x2={PLOT_W} y1={y(warn)} y2={y(warn)} />
        )}

        {gaps.map((g) => {
          const x1 = Math.max(0, xOf(g.fromMs));
          const x2 = Math.min(PLOT_W, xOf(g.toMs));
          return (
            <g key={g.fromMs} data-testid="gap">
              <rect
                className={styles.gap}
                x={x1}
                y={0}
                width={Math.max(0, x2 - x1)}
                height={PLOT_H}
              />
              {x2 - x1 > PLOT_W * 0.1 && (
                <text
                  className={styles.gapLabel}
                  x={(x1 + x2) / 2}
                  y={PLOT_H / 2}
                  textAnchor="middle"
                >
                  not sampled
                </text>
              )}
            </g>
          );
        })}

        <g clipPath={`url(#${clipId})`}>
          {lines.map((points) => {
            const area = areaPath(points, PLOT_H);
            return (
              <g key={points}>
                {area && <path className={styles.area} d={area} />}
                <polyline className={styles.line} points={points} />
              </g>
            );
          })}
        </g>

        {!hasData && (
          <text className={styles.gapLabel} x={PLOT_W / 2} y={PLOT_H / 2} textAnchor="middle">
            not sampled
          </text>
        )}

        {peak && (
          <g data-testid="peak">
            <circle className={styles.peakDot} cx={peakX} cy={y(peak.value)} r={3.5} />
            <text
              className={styles.peakLabel}
              x={peakX > PLOT_W * 0.6 ? peakX - 8 : peakX + 8}
              y={Math.max(10, y(peak.value) - 6)}
              textAnchor={peakX > PLOT_W * 0.6 ? "end" : "start"}
            >
              {peakLabel}
            </text>
          </g>
        )}

        {strip && (
          <g aria-hidden="true">
            {strip.buckets.map((b, i) =>
              b ? (
                <rect
                  key={b.tMs}
                  className={styles.stripCell}
                  data-level={LEVEL_FOR_THERMAL[Math.min(3, Math.max(0, Math.round(b.max)))]}
                  x={(i / strip.buckets.length) * PLOT_W}
                  y={STRIP_Y - TOP}
                  width={PLOT_W / strip.buckets.length + 0.5}
                  height={STRIP_H}
                />
              ) : null,
            )}
          </g>
        )}

        {hover !== null && hovered && (
          <g aria-hidden="true">
            <line
              className={styles.rule}
              x1={xOf(hovered.tMs)}
              x2={xOf(hovered.tMs)}
              y1={0}
              y2={PLOT_H}
            />
            <circle className={styles.hoverDot} cx={xOf(hovered.tMs)} cy={y(hovered.avg)} r={3} />
            <text
              className={styles.readout}
              x={xOf(hovered.tMs) > PLOT_W * 0.7 ? xOf(hovered.tMs) - 8 : xOf(hovered.tMs) + 8}
              y={TOP + 8}
              textAnchor={xOf(hovered.tMs) > PLOT_W * 0.7 ? "end" : "start"}
            >
              {`${clock(hovered.tMs)} · ${formatChartValue(hovered.avg, unit)}`}
            </text>
          </g>
        )}
      </g>
      <text className={styles.tick} x={LEFT} y={AXIS_Y} textAnchor="start">
        {RANGE_WORDS[series.range]}
      </text>
      <text className={styles.tick} x={VB_W - 6} y={AXIS_Y} textAnchor="end">
        now
      </text>
    </svg>
  );
}
