import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActiveAlert, FocusTarget } from "@/lib/alerts";

const hooks = vi.hoisted(() => ({
  alerts: [] as ActiveAlert[],
  focus: null as ((t: FocusTarget) => void) | null,
}));

vi.mock("@/hooks/use-active-alerts", () => ({ useActiveAlerts: () => hooks.alerts }));
vi.mock("@/hooks/use-alert-focus", () => ({
  useAlertFocus: (cb: (t: FocusTarget) => void) => {
    hooks.focus = cb;
  },
}));

import App from "./App";
import { resetMemorySettings } from "@/settings/store";

function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  );
}

const thermal: ActiveAlert = {
  id: "health:thermalPressure",
  rule: "thermalPressure",
  level: "stop",
  title: "Thermal pressure Serious",
  reading: "Serious",
  culprit: { pid: 4101, startedAt: 1_700_000_001, name: "Cursor", killable: true },
  sinceEpochMs: 1,
  target: { kind: "process", pid: 4101, startedAt: 1_700_000_001 },
};

afterEach(() => {
  hooks.alerts = [];
  hooks.focus = null;
  window.localStorage.clear();
  resetMemorySettings();
});

describe("alerts in the panel", () => {
  it("counts the firing alerts on the Machine tab label while Ports is showing", async () => {
    hooks.alerts = [thermal];
    renderApp();
    await screen.findByText("3000");
    expect(screen.getByRole("tab", { name: /^Machine\s*1$/ })).toBeTruthy();
  });

  it("the Machine tab shows the band above the gauges", async () => {
    hooks.alerts = [thermal];
    renderApp();
    await screen.findByText("3000");
    act(() => {
      screen.getByRole("tab", { name: /^Machine/ }).click();
    });
    await screen.findByRole("group", { name: /^CPU,/ });
    const band = screen.getByRole("status", { name: "Active alert" });
    expect(band.textContent).toContain("Thermal pressure Serious");
    expect(band.textContent).toContain("Cursor");
  });

  it("a notification click on a process opens Machine with that row selected", async () => {
    renderApp();
    await screen.findByText("3000");
    act(() => hooks.focus?.({ kind: "process", pid: 4101, startedAt: 1_700_000_001 }));
    await screen.findByRole("group", { name: /^CPU,/ });
    await waitFor(() => {
      const row = screen.getAllByTestId("process-row")[0]!;
      expect(row.className).toMatch(/procRowSelected/);
    });
  });

  it("a notification click on a port opens Ports and selects that row", async () => {
    renderApp();
    await screen.findByText("3000");
    act(() => hooks.focus?.({ kind: "port", port: 5173 }));
    await waitFor(() => {
      expect(screen.getByText("5173").closest("li")!.getAttribute("aria-selected")).toBe("true");
    });
  });
});
