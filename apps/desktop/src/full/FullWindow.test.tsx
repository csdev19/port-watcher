import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import FullWindow from "./FullWindow";
import * as machine from "@/lib/machine";
import * as ports from "@/lib/ports";
import { resetMemorySettings } from "@/settings/store";

function renderFull() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <FullWindow />
    </QueryClientProvider>,
  );
}

describe("FullWindow", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    resetMemorySettings();
  });

  it("has exactly Overview, Ports, Alerts and Settings in the sidebar", async () => {
    renderFull();
    const nav = await screen.findByRole("navigation", { name: "Full window" });
    const labels = [...nav.querySelectorAll("button")].map((b) =>
      b.textContent?.replace(/\d+$/, ""),
    );
    expect(labels).toEqual(["Overview", "Ports", "Alerts", "Settings"]);
  });

  it("opens on Overview with the chart, Right now and the process table", async () => {
    renderFull();
    await screen.findByRole("img", { name: /^CPU history:/ });
    expect(await screen.findByRole("region", { name: "Right now" })).toBeTruthy();
    expect(await screen.findAllByTestId("process-row")).not.toHaveLength(0);
    expect(screen.getByText("Apple M4 Pro")).toBeTruthy();
  });

  it("switches the metric and the range", async () => {
    const history = vi.spyOn(machine, "machineHistory");
    renderFull();
    await screen.findByRole("img", { name: /^CPU history:/ });
    fireEvent.click(screen.getByRole("button", { name: "GPU" }));
    fireEvent.click(screen.getByRole("button", { name: "1 h" }));
    await screen.findByRole("img", { name: /^GPU history:/ });
    expect(history).toHaveBeenCalledWith("gpu", "1h");
    fireEvent.click(screen.getByRole("button", { name: "Heat" }));
    await screen.findByRole("img", { name: /^Heat history:/ });
    expect(history).toHaveBeenCalledWith("hotspot", "1h");
    expect(history).toHaveBeenCalledWith("thermalLevel", "1h");
  });

  it("Settings opens the existing Settings window", async () => {
    const open = vi.spyOn(ports, "openSettings").mockResolvedValue();
    renderFull();
    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("Mini closes the window to the panel", async () => {
    const mini = vi.spyOn(machine, "closeFullWindowToMini").mockResolvedValue();
    renderFull();
    fireEvent.click(await screen.findByRole("button", { name: "Mini" }));
    expect(mini).toHaveBeenCalledTimes(1);
  });

  it("Ports shows the port list at full width", async () => {
    renderFull();
    fireEvent.click(await screen.findByRole("button", { name: /^Ports/ }));
    expect(await screen.findByText("3000")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Right now" })).toBeNull();
  });
});
