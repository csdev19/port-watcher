import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MachineView } from "./MachineView";
import { PanelHeader } from "./PanelHeader";
import { mockMachineSnapshot } from "@/lib/mock-machine";
import * as machine from "@/lib/machine";
import type { GaugeDto, MachineSnapshot } from "@/lib/machine-types";

function renderView(snapshot: MachineSnapshot) {
  vi.spyOn(machine, "topProcesses").mockResolvedValue([]);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MachineView snapshot={snapshot} error={null} onToast={() => {}} />
    </QueryClientProvider>,
  );
}

function withGauge(id: GaugeDto["id"], over: Partial<GaugeDto>): MachineSnapshot {
  const snap = mockMachineSnapshot(1_000_000);
  return {
    ...snap,
    gauges: snap.gauges.map((g) => (g.id === id ? { ...g, ...over } : g)),
  };
}

describe("MachineView gauges", () => {
  afterEach(() => vi.restoreAllMocks());

  it("renders four gauges with value, driver and the band in words", () => {
    renderView(mockMachineSnapshot(1_000_000));
    const cpu = screen.getByRole("group", { name: /^CPU, 41%/ });
    expect(within(cpu).getByText("41%")).toBeTruthy();
    expect(within(cpu).getByText("Cursor Helper 22% · 12 cores")).toBeTruthy();
    expect(within(cpu).getByText("ok < 80 · warn ≥ 80")).toBeTruthy();
    expect(screen.getByRole("group", { name: /^GPU,/ })).toBeTruthy();
    expect(screen.getByRole("group", { name: /^Heat,/ })).toBeTruthy();
    expect(screen.getByRole("group", { name: /^Memory,/ })).toBeTruthy();
    expect(screen.getAllByRole("group")).toHaveLength(4);
  });

  it("maps the level to the gauge's data-level and says it in the accessible name", () => {
    renderView(withGauge("heat", { level: "stop", value: "Nominal", extra: "115 °C" }));
    const heat = screen.getByRole("group", { name: /^Heat,/ });
    expect(heat.getAttribute("data-level")).toBe("stop");
    expect(heat.getAttribute("aria-label")).toContain("Nominal, hotspot 115 °C, stop");
    expect(screen.getByRole("group", { name: /^CPU,/ }).getAttribute("data-level")).toBe("ok");
  });

  it("shows the Heat hotspot prominently next to the pressure word", () => {
    renderView(withGauge("heat", { level: "stop", value: "Nominal", extra: "115 °C" }));
    const heat = screen.getByRole("group", { name: /^Heat,/ });
    expect(within(heat).getByText("115 °C")).toBeTruthy();
    expect(within(heat).getByText(/Nominal/)).toBeTruthy();
  });

  it("renders n/a with the reason when a gauge is unavailable", () => {
    renderView(
      withGauge("gpu", {
        available: false,
        value: "n/a",
        unavailableReason: "GPU load is not reported on this Mac",
      }),
    );
    const gpu = screen.getByRole("group", { name: /^GPU, not available/ });
    expect(within(gpu).getByText("GPU load is not reported on this Mac")).toBeTruthy();
    expect(gpu.getAttribute("data-level")).toBe("off");
  });

  it("draws the sparkline with warn and stop lines from the gauge numbers", () => {
    const { container } = renderView(mockMachineSnapshot(1_000_000));
    const heat = container.querySelector('[data-gauge="heat"] svg')!;
    expect(heat.querySelectorAll("line")).toHaveLength(2);
    const cpu = container.querySelector('[data-gauge="cpu"] svg')!;
    expect(cpu.querySelectorAll("line")).toHaveLength(1);
    expect(cpu.getAttribute("aria-hidden")).toBe("true");
    expect(cpu.querySelectorAll("polyline").length).toBeGreaterThan(0);
  });

  it("says 'collecting…' instead of an empty chart before history exists", () => {
    const snap = { ...mockMachineSnapshot(1_000_000), history: [] };
    renderView(snap);
    expect(screen.getAllByText("collecting…").length).toBeGreaterThan(0);
  });

  it("does not use inline style attributes (production CSP)", () => {
    const { container } = renderView(mockMachineSnapshot(1_000_000));
    expect(container.querySelectorAll("[style]")).toHaveLength(0);
  });
});

describe("verdict pill", () => {
  it("shows the verdict word and carries the reasons in its accessible name", () => {
    render(
      <PanelHeader count={3} verdict={{ level: "stop", reasons: ["thermal pressure serious"] }} />,
    );
    const pill = screen.getByRole("status", {
      name: /System health: Stop\. thermal pressure serious/,
    });
    expect(pill.textContent).toBe("Stop");
    expect(pill.getAttribute("data-tone")).toBe("stop");
    expect(pill.getAttribute("aria-live")).toBe("polite");
  });

  it("keeps the listening count when no verdict is given", () => {
    render(<PanelHeader count={3} />);
    expect(screen.getByText("3 listening")).toBeTruthy();
  });
});

describe("MachineView full window button", () => {
  afterEach(() => vi.restoreAllMocks());

  it("the ⤢ button opens the full window", () => {
    const open = vi.spyOn(machine, "openFullWindow").mockResolvedValue();
    renderView(mockMachineSnapshot(1_000_000));
    fireEvent.click(screen.getByRole("button", { name: "Open full window" }));
    expect(open).toHaveBeenCalledTimes(1);
  });
});
