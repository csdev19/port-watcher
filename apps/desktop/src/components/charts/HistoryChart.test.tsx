import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HistoryChart } from "./HistoryChart";
import type { GaugeDto, SeriesDto } from "@/lib/machine-types";

const gauge: GaugeDto = {
  id: "cpu",
  level: "ok",
  value: "41%",
  extra: null,
  driver: "",
  warn: 80,
  stop: 95,
  min: 0,
  max: 100,
  unit: "%",
  available: true,
  unavailableReason: null,
};

function series(filled: number[], over: Partial<SeriesDto> = {}): SeriesDto {
  return {
    metric: "cpu",
    range: "1m",
    bucketMs: 1000,
    endMs: 60_000,
    buckets: Array.from({ length: 60 }, (_, i) =>
      filled.includes(i + 1) ? { tMs: (i + 1) * 1000, min: 10, avg: 50, max: 90 } : null,
    ),
    peak: null,
    ...over,
  };
}

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

describe("HistoryChart", () => {
  it("shows a loading state without a series", () => {
    render(<HistoryChart series={undefined} gauge={gauge} showCulprit label="CPU history" />);
    expect(screen.getByRole("status").textContent).toBe("Reading history…");
  });

  it("draws one polyline per run and splits at an unsampled span", () => {
    const { container } = render(
      <HistoryChart
        series={series([...range(1, 10), ...range(40, 60)])}
        gauge={gauge}
        showCulprit
        label="CPU history"
      />,
    );
    expect(container.querySelectorAll("polyline")).toHaveLength(2);
  });

  it("labels a wide gap 'not sampled' and never draws a line across it", () => {
    const { container } = render(
      <HistoryChart
        series={series([...range(1, 10), ...range(40, 60)])}
        gauge={gauge}
        showCulprit
        label="CPU history"
      />,
    );
    expect(screen.getByText("not sampled")).toBeTruthy();
    expect(container.querySelectorAll('[data-testid="gap"]')).toHaveLength(1);
  });

  it("an all-empty series says not sampled and draws no line", () => {
    const { container } = render(
      <HistoryChart series={series([])} gauge={gauge} showCulprit label="CPU history" />,
    );
    expect(container.querySelectorAll("polyline")).toHaveLength(0);
    expect(screen.getAllByText("not sampled").length).toBeGreaterThan(0);
  });

  it("writes the peak with its time and the heaviest process", () => {
    render(
      <HistoryChart
        series={series(range(1, 60), {
          peak: { tMs: 30_000, value: 97, top: { name: "Cursor", cpuPct: 90 } },
        })}
        gauge={gauge}
        showCulprit
        label="CPU history"
      />,
    );
    const peak = screen.getByTestId("peak");
    expect(within(peak).getByText(/^peak 97 % at \d\d:\d\d · Cursor$/)).toBeTruthy();
  });

  it("leaves the process out of the peak when the metric is not CPU-driven", () => {
    render(
      <HistoryChart
        series={series(range(1, 60), {
          peak: { tMs: 30_000, value: 80, top: { name: "Cursor", cpuPct: 90 } },
        })}
        gauge={{ ...gauge, id: "memory" }}
        showCulprit={false}
        label="Memory history"
      />,
    );
    expect(screen.getByTestId("peak").textContent).not.toContain("Cursor");
  });

  it("draws warn and stop lines from the gauge numbers and the level as a data attribute", () => {
    const { container } = render(
      <HistoryChart
        series={series(range(1, 60))}
        gauge={{ ...gauge, level: "watch" }}
        showCulprit
        label="CPU history"
      />,
    );
    const lines = [...container.querySelectorAll("line")];
    // 160 px plot: warn 80 sits above stop-free 20 % of the height, stop 95 above that.
    const ys = lines.map((l) => Number(l.getAttribute("y1"))).filter((y) => y > 0 && y < 160);
    expect(ys.length).toBeGreaterThanOrEqual(2);
    expect(container.querySelector("svg")!.getAttribute("data-level")).toBe("watch");
  });

  it("describes itself for screen readers", () => {
    render(
      <HistoryChart series={series(range(1, 60))} gauge={gauge} showCulprit label="CPU history" />,
    );
    expect(screen.getByRole("img").getAttribute("aria-label")).toMatch(
      /^CPU history: 50 % to 50 %/,
    );
  });

  it("colours the thermal strip by level", () => {
    const strip = series(range(1, 60), { metric: "thermalLevel" });
    strip.buckets = strip.buckets.map((b, i) =>
      b ? { ...b, max: i < 30 ? 0 : 2, avg: i < 30 ? 0 : 2 } : b,
    );
    const { container } = render(
      <HistoryChart
        series={series(range(1, 60))}
        strip={strip}
        gauge={{ ...gauge, id: "heat", unit: "°C", min: 30, max: 120 }}
        showCulprit
        label="Heat history"
      />,
    );
    expect(container.querySelectorAll('rect[data-level="ok"]')).toHaveLength(30);
    expect(container.querySelectorAll('rect[data-level="stop"]')).toHaveLength(30);
  });
});
