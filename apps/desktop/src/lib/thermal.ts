import { invoke } from "@tauri-apps/api/core";
import { inTauri } from "./ports";
import type {
  ThermalBand,
  ThermalBucket,
  ThermalDay,
  ThermalHistory,
  ThermalReading,
  ThermalState,
} from "./types";

/** A fresh sensor read; `null` when this Mac exposes no die sensor. */
export async function thermalCurrent(): Promise<ThermalReading | null> {
  if (!inTauri) return mockReading(Math.floor(Date.now() / 1000));
  return invoke<ThermalReading | null>("thermal_current");
}

/** Buckets and peaks in [fromS, toS] plus the last `days` daily summaries. */
export async function thermalHistory(
  fromS: number,
  toS: number,
  days: number,
): Promise<ThermalHistory> {
  if (!inTauri) return mockHistory(fromS, toS, days);
  return invoke<ThermalHistory>("thermal_history", { fromS, toS, days });
}

/** Community-reported context for the average die temperature. */
export const BAND_COPY: Record<ThermalBand, string> = {
  cool: "Idle or light work",
  normal: "Everyday work",
  warm: "Sustained load: builds, video, many tabs",
  hot: "Heavy load, close to throttling",
  throttling: "macOS slows the chip to cool it",
};

/** What macOS itself reports through `thermalState`. */
export const STATE_COPY: Record<ThermalState, string> = {
  nominal: "macOS reports no thermal pressure",
  fair: "macOS reports slightly raised thermal pressure",
  serious: "macOS reports high thermal pressure",
  critical: "macOS reports critical thermal pressure",
};

/** Band edges (°C) on the average die temperature, for chart shading. */
export const BAND_EDGES = [50, 70, 90, 100] as const;

export function formatTemp(c: number): string {
  return `${Math.round(c)}°`;
}

/** "+4° vs your 7-day average", or null while there is no baseline. */
export function baselineDelta(reading: Pick<ThermalReading, "avgC" | "baselineC">): string | null {
  if (reading.baselineC === null) return null;
  const delta = Math.round(reading.avgC) - Math.round(reading.baselineC);
  if (delta === 0) return "At your 7-day average";
  return `${delta > 0 ? "+" : "-"}${Math.abs(delta)}° vs your 7-day average`;
}

/** Local midnight to `now`, in epoch seconds. */
export function todayRange(now: Date): { fromS: number; toS: number } {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return { fromS: Math.floor(midnight.getTime() / 1000), toS: Math.floor(now.getTime() / 1000) };
}

/** "Mon 3" for a local `YYYY-MM-DD`. */
export function formatDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], { weekday: "short", day: "numeric" });
}

/** "14:05" in the user's locale. */
export function formatClock(epochS: number): string {
  return new Date(epochS * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** min/avg/max across buckets, weighting each bucket's average by its samples. */
export function summarize(
  buckets: ThermalBucket[],
): { min: number; avg: number; max: number } | null {
  const samples = buckets.reduce((n, b) => n + b.samples, 0);
  if (buckets.length === 0 || samples === 0) return null;
  return {
    min: Math.min(...buckets.map((b) => b.minC)),
    avg: buckets.reduce((sum, b) => sum + b.avgC * b.samples, 0) / samples,
    max: Math.max(...buckets.map((b) => b.maxAvgC)),
  };
}

// --- Browser dev loop mocks (deterministic apart from the clock) ---

function mockReading(at: number): ThermalReading {
  return {
    avgC: 58.4,
    maxC: 66.2,
    sensors: 6,
    state: "nominal",
    band: "normal",
    at,
    baselineC: 54,
  };
}

function mockHistory(fromS: number, toS: number, days: number): ThermalHistory {
  const end = Math.floor(toS / 300) * 300;
  const buckets: ThermalBucket[] = [];
  for (let i = 0; i < 12; i++) {
    const startS = end - (11 - i) * 300;
    if (startS < fromS) continue;
    const avgC = 52 + (i % 4) * 3 + (i > 7 ? 14 : 0);
    buckets.push({
      startS,
      minC: avgC - 3,
      avgC,
      maxAvgC: avgC + 4,
      maxC: avgC + 11,
      worstState: "nominal",
      samples: 5,
    });
  }
  // Thirty minutes ago, but never before the range starts: just after
  // midnight the mock must still show a peak for "today".
  const peakAt = Math.max(end - 1800, fromS);
  const peaks =
    peakAt <= toS
      ? [
          {
            id: 1,
            atS: peakAt,
            avgC: 88.1,
            maxC: 97.3,
            state: "fair" as ThermalState,
            processes: [
              { pid: 4242, name: "node", cpu: 212, ports: [5173] },
              { pid: 777, name: "Google Chrome Helper", cpu: 64, ports: [] },
            ],
          },
        ]
      : [];
  const daySummaries: ThermalDay[] = [];
  for (let i = days; i >= 1; i--) {
    const d = new Date(toS * 1000);
    d.setDate(d.getDate() - i);
    const pad = (n: number) => String(n).padStart(2, "0");
    daySummaries.push({
      day: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      minC: 44 + (i % 3),
      avgC: 55 + (i % 4),
      maxC: 80 + i,
      seriousMinutes: i === 3 ? 12 : 0,
    });
  }
  return { available: true, buckets, peaks, days: daySummaries };
}
