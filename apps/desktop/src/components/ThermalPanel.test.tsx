import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThermalPanel } from "./ThermalPanel";
import * as thermal from "@/lib/thermal";

function renderPanel() {
  const onShowPort = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ThermalPanel onShowPort={onShowPort} />
    </QueryClientProvider>,
  );
  return { onShowPort };
}

describe("ThermalPanel", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows the reading with its band copy, state copy and baseline", async () => {
    renderPanel();
    expect(await screen.findByText("58°")).toBeTruthy();
    expect(screen.getByText("Everyday work")).toBeTruthy();
    expect(screen.getByText("macOS reports no thermal pressure")).toBeTruthy();
    expect(screen.getByText("+4° vs your 7-day average")).toBeTruthy();
  });

  it("shows today's chart and the peak with its process", async () => {
    renderPanel();
    expect(await screen.findByRole("img", { name: /Temperature today/ })).toBeTruthy();
    expect(screen.getByText("Peaks today")).toBeTruthy();
    expect(screen.getByText("node")).toBeTruthy();
  });

  it("sends the port to onShowPort when its pill is clicked", async () => {
    const { onShowPort } = renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Show port 5173" }));
    expect(onShowPort).toHaveBeenCalledWith(5173);
  });

  it("keeps the three most recent peaks, newest first", async () => {
    const proc = { pid: 1, name: "node", cpu: 50, ports: [] };
    const base = thermal.todayRange(new Date()).fromS;
    // Rust's order: newest first.
    const peaks = [4, 3, 2, 1].map((h) => ({
      id: h,
      atS: base + h * 60,
      avgC: 80 + h,
      maxC: 95 + h,
      state: "nominal" as const,
      processes: [proc],
    }));
    vi.spyOn(thermal, "thermalHistory").mockResolvedValue({
      available: true,
      buckets: [],
      peaks,
      days: [],
    });
    renderPanel();
    expect(await screen.findByText("84°")).toBeTruthy();
    expect(screen.getByText("83°")).toBeTruthy();
    expect(screen.getByText("82°")).toBeTruthy();
    expect(screen.queryByText("81°")).toBeNull();
  });

  it("says so when there are no sensors", async () => {
    vi.spyOn(thermal, "thermalCurrent").mockResolvedValue(null);
    renderPanel();
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
    renderPanel();
    expect(await screen.findByText("History is unavailable right now.")).toBeTruthy();
    expect(screen.queryByText("Peaks today")).toBeNull();
  });
});
