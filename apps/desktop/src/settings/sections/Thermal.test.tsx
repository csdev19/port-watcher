import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import Thermal from "./Thermal";
import * as thermal from "../../lib/thermal";
import { getSetting, resetMemorySettings } from "../store";

describe("Settings > Thermal", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetMemorySettings();
  });

  it("shows the reading with its band copy, state copy and baseline", async () => {
    render(<Thermal />);
    expect(await screen.findByText("58°")).toBeTruthy();
    expect(screen.getByText("Everyday work")).toBeTruthy();
    expect(screen.getByText("macOS reports no thermal pressure")).toBeTruthy();
    expect(screen.getByText("+4° vs your 7-day average")).toBeTruthy();
    expect(screen.getByText(/community-reported/)).toBeTruthy();
  });

  it("lists the peak with its process, CPU and the port it holds", async () => {
    render(<Thermal />);
    expect(await screen.findByText("node")).toBeTruthy();
    expect(screen.getByText("212% CPU")).toBeTruthy();
    expect(screen.getByText("5173")).toBeTruthy();
    expect(screen.getByText("Last 7 days")).toBeTruthy();
    expect(screen.getByRole("img", { name: /Temperature today/ })).toBeTruthy();
  });

  it("draws a lone bucket as a dot instead of nothing", async () => {
    const startS = thermal.todayRange(new Date()).fromS + 60;
    vi.spyOn(thermal, "thermalHistory").mockResolvedValue({
      available: true,
      buckets: [
        { startS, minC: 50, avgC: 55, maxAvgC: 56, maxC: 70, worstState: "nominal", samples: 5 },
      ],
      peaks: [],
      days: [],
    });
    render(<Thermal />);
    const chart = await screen.findByRole("img", { name: /Temperature today/ });
    const paths = [...chart.querySelectorAll("path")].map((p) => p.getAttribute("d") ?? "");
    expect(paths.some((d) => d.startsWith("M") && d.endsWith("h0.01"))).toBe(true);
  });

  it("says so when there are no sensors", async () => {
    vi.spyOn(thermal, "thermalCurrent").mockResolvedValue(null);
    render(<Thermal />);
    expect(
      await screen.findByText("Temperature sensors are not available on this Mac."),
    ).toBeTruthy();
  });

  it("says so when history is unavailable", async () => {
    vi.spyOn(thermal, "thermalHistory").mockResolvedValue({
      available: false,
      buckets: [],
      peaks: [],
      days: [],
    });
    render(<Thermal />);
    expect(await screen.findByText("History is unavailable right now.")).toBeTruthy();
    expect(screen.queryByText("Peaks")).toBeNull();
  });

  it("saves both switches as soon as they change", async () => {
    render(<Thermal />);
    const record = screen.getByRole("switch", { name: "Record temperature in the background" });
    const show = screen.getByRole("switch", { name: "Show temperature in the panel" });
    expect(record.getAttribute("aria-checked")).toBe("true");
    expect(show.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(record);
    fireEvent.click(show);
    await waitFor(async () => {
      expect(await getSetting("thermalGuardEnabled")).toBe(false);
      expect(await getSetting("showTemperatureInPanel")).toBe(true);
    });
  });
});
