import type { GaugeDto, Level } from "@/lib/machine-types";

/** Level to the data attribute the stylesheet colours by. Colour is never the only signal:
 * the level word is always in text too (`levelWord`). */
export function levelTone(level: Level): "ok" | "watch" | "stop" {
  return level;
}

export function levelWord(level: Level): string {
  return level === "ok" ? "normal" : level === "watch" ? "watch" : "stop";
}

const n = (v: number) => String(Math.round(v * 10) / 10);

/** The reference band in words, drawn from the same numbers as the sparkline lines. */
export function bandText(g: Pick<GaugeDto, "id" | "warn" | "stop" | "unit">): string {
  if (g.id === "memory") return "Normal · Warning · Critical";
  if (g.id === "heat" && g.unit === "level") return "Nominal · Fair · Serious · Critical";
  const unit = g.unit === "°C" ? " °C" : "";
  if (g.warn === null) return "";
  if (g.stop === null) return `ok < ${n(g.warn)}${unit} · warn ≥ ${n(g.warn)}${unit}`;
  return `ok < ${n(g.warn)} · warn ${n(g.warn)}–${n(g.stop)} · stop ≥ ${n(g.stop)}${unit}`;
}

export const GAUGE_LABELS: Record<GaugeDto["id"], string> = {
  cpu: "CPU",
  gpu: "GPU",
  heat: "Heat",
  memory: "Memory",
};

/** The gauge's spoken summary: "CPU, 34%, normal. Cursor Helper 22% · 12 cores. ok < 80 ...". */
export function gaugeAriaLabel(g: GaugeDto): string {
  const label = GAUGE_LABELS[g.id];
  if (!g.available) return `${label}, not available. ${g.unavailableReason ?? ""}`.trim();
  const value = g.extra ? `${g.value}, hotspot ${g.extra}` : g.value;
  const band = bandText(g);
  return `${label}, ${value}, ${levelWord(g.level)}. ${g.driver}.${band ? ` ${band}` : ""}`;
}
