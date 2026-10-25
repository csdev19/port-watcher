import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import * as portsModule from "@/lib/ports";
import * as machine from "@/lib/machine";
import { resetMemorySettings } from "@/settings/store";

function renderApp() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  );
}

describe("top-level tabs", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    resetMemorySettings();
  });

  it("opens on Ports and keeps its sub-tabs one level down", async () => {
    renderApp();
    await screen.findByText("3000");
    expect(screen.getByRole("tablist", { name: "Panel" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /^Ports/ }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tablist", { name: "Ports" })).toBeTruthy();
    expect(screen.getByText(/^\d+ listening$/)).toBeTruthy();
  });

  it("does not sample the machine while Ports is showing", async () => {
    const snap = vi.spyOn(machine, "machineSnapshot");
    const top = vi.spyOn(machine, "topProcesses");
    renderApp();
    await screen.findByText("3000");
    expect(snap).not.toHaveBeenCalled();
    expect(top).not.toHaveBeenCalled();
  });

  it("Machine shows the gauges, the verdict pill and the real machine in the footer", async () => {
    renderApp();
    await screen.findByText("3000");
    fireEvent.click(screen.getByRole("tab", { name: /^Machine/ }));
    await screen.findByRole("group", { name: /^CPU,/ });
    expect(screen.getByText("Apple M4 Pro · 12 cores · 1s")).toBeTruthy();
    expect(screen.getByRole("status", { name: /^System health: Watch/ })).toBeTruthy();
    expect(screen.queryByText(/listening$/)).toBeNull();
  });

  it("⌘1 and ⌘2 switch tabs", async () => {
    renderApp();
    await screen.findByText("3000");
    fireEvent.keyDown(window, { key: "2", metaKey: true });
    await screen.findByRole("group", { name: /^CPU,/ });
    fireEvent.keyDown(window, { key: "1", metaKey: true });
    await screen.findByText("3000");
    expect(screen.queryByRole("group", { name: /^CPU,/ })).toBeNull();
  });

  it("on Machine, ⌘↩ opens the full window; on Ports it does not", async () => {
    const open = vi.spyOn(machine, "openFullWindow").mockResolvedValue();
    renderApp();
    await screen.findByText("3000");
    fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    expect(open).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("tab", { name: /^Machine/ }));
    await screen.findByRole("group", { name: /^CPU,/ });
    fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("on Machine, ⌘⌫ never kills a port", async () => {
    const killPort = vi.spyOn(portsModule, "killPort");
    renderApp();
    await screen.findByText("3000");
    fireEvent.click(screen.getByRole("tab", { name: /^Machine/ }));
    await screen.findByRole("group", { name: /^CPU,/ });
    fireEvent.keyDown(window, { key: "Backspace", metaKey: true });
    fireEvent.keyDown(window, { key: "Backspace", metaKey: true });
    expect(killPort).not.toHaveBeenCalled();
  });

  it("switching to Machine and back keeps Ports working", async () => {
    renderApp();
    await screen.findByText("3000");
    fireEvent.click(screen.getByRole("tab", { name: /^Machine/ }));
    await screen.findByRole("group", { name: /^CPU,/ });
    fireEvent.click(screen.getByRole("tab", { name: /^Ports/ }));
    await waitFor(() => expect(screen.getByText("3000")).toBeTruthy());
    expect(screen.getByText(/^\d+ listening$/)).toBeTruthy();
  });
});
