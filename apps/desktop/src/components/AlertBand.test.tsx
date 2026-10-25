import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AlertBand, leadAlert } from "./AlertBand";
import * as machine from "@/lib/machine";
import type { ActiveAlert } from "@/lib/alerts";

function alert(over: Partial<ActiveAlert> = {}): ActiveAlert {
  return {
    id: "health:thermalPressure",
    rule: "thermalPressure",
    level: "stop",
    title: "Thermal pressure Serious",
    reading: "Serious",
    culprit: { pid: 321, startedAt: 1757, name: "ollama", killable: true },
    sinceEpochMs: 1000,
    target: { kind: "process", pid: 321, startedAt: 1757 },
    ...over,
  };
}

function renderBand(alerts: ActiveAlert[], onToast = vi.fn()) {
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <AlertBand alerts={alerts} onToast={onToast} />
    </QueryClientProvider>,
  );
  return onToast;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("AlertBand", () => {
  it("renders nothing without alerts", () => {
    renderBand([]);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("names the rule and the culprit, with the severity on the band", () => {
    renderBand([alert()]);
    const band = screen.getByRole("status");
    expect(band.getAttribute("data-level")).toBe("stop");
    expect(band.textContent).toContain("Thermal pressure Serious");
    expect(band.textContent).toContain("ollama");
  });

  it("leads with the highest level and counts the rest", () => {
    const watch = alert({
      id: "health:memoryPressure",
      level: "watch",
      title: "Memory pressure Warning",
    });
    renderBand([watch, alert()]);
    expect(screen.getByRole("status").textContent).toContain("Thermal pressure Serious");
    expect(screen.getByText("+1")).toBeTruthy();
    expect(leadAlert([watch, alert()])?.level).toBe("stop");
  });

  it("shows no kill button when Rust says the culprit is not killable", () => {
    renderBand([
      alert({ culprit: { pid: 1, startedAt: 1, name: "WindowServer", killable: false } }),
    ]);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows no kill button when there is no culprit", () => {
    renderBand([alert({ culprit: null, target: null })]);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Thermal pressure Serious");
  });

  it("kills in two steps: the first click only arms", async () => {
    const kill = vi.spyOn(machine, "killProcess").mockResolvedValue("terminated");
    const onToast = renderBand([alert()]);
    fireEvent.click(screen.getByRole("button", { name: "Kill ollama" }));
    expect(kill).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm: kill ollama" }));
    await act(async () => {});
    expect(kill).toHaveBeenCalledExactlyOnceWith({ pid: 321, startedAt: 1757 });
    expect(onToast).toHaveBeenCalledWith({ message: "ollama stopped", command: null });
  });

  it("disarms after two seconds", () => {
    const kill = vi.spyOn(machine, "killProcess").mockResolvedValue("terminated");
    renderBand([alert()]);
    fireEvent.click(screen.getByRole("button", { name: "Kill ollama" }));
    act(() => {
      vi.advanceTimersByTime(2100);
    });
    fireEvent.click(screen.getByRole("button", { name: "Kill ollama" }));
    expect(kill).not.toHaveBeenCalled();
  });

  it("reports a refused kill", async () => {
    vi.spyOn(machine, "killProcess").mockResolvedValue("permissionDenied");
    const onToast = renderBand([alert()]);
    fireEvent.click(screen.getByRole("button", { name: "Kill ollama" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm: kill ollama" }));
    await act(async () => {});
    expect(onToast).toHaveBeenCalledWith({ message: "Cannot kill ollama", command: null });
  });
});
