import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActiveAlert, AlertRule } from "@/lib/alerts";

const api = vi.hoisted(() => ({
  listAlertRules: vi.fn<() => Promise<AlertRule[]>>(),
  getActiveAlerts: vi.fn<() => Promise<ActiveAlert[]>>(),
  setAlertRuleEnabled: vi.fn<(rule: string, enabled: boolean) => Promise<void>>(),
  emit: null as ((payload: ActiveAlert[]) => void) | null,
}));

vi.mock("@/lib/alerts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/alerts")>()),
  listAlertRules: api.listAlertRules,
  getActiveAlerts: api.getActiveAlerts,
  // Both hooks subscribe to alerts-changed; the test fires the same payload to every listener.
  listenTo: (_event: string, cb: (payload: ActiveAlert[]) => void) => {
    const prev = api.emit;
    api.emit = (p) => {
      prev?.(p);
      cb(p);
    };
    return () => {};
  },
}));
vi.mock("@/settings/native", () => ({
  setAlertRuleEnabled: api.setAlertRuleEnabled,
}));

import * as machine from "@/lib/machine";
import { useActiveAlerts } from "@/hooks/use-active-alerts";
import { AlertsPage } from "./AlertsPage";

const rules: AlertRule[] = [
  {
    id: "thermalPressure",
    title: "Thermal pressure Serious",
    sub: "Notifies and names the top process",
    enabled: true,
    firing: false,
  },
  {
    id: "memoryPressure",
    title: "Memory pressure Warning",
    sub: "macOS is short on memory",
    enabled: false,
    firing: false,
  },
];

const firing: ActiveAlert = {
  id: "health:thermalPressure",
  rule: "thermalPressure",
  level: "stop",
  title: "Thermal pressure Serious",
  reading: "Serious",
  culprit: { pid: 321, startedAt: 1757, name: "ollama", killable: true },
  sinceEpochMs: 1,
  target: { kind: "process", pid: 321, startedAt: 1757 },
};

function Harness({ onToast }: { onToast: () => void }) {
  return <AlertsPage alerts={useActiveAlerts()} onToast={onToast} />;
}

function renderPage(onToast = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Harness onToast={onToast} />
    </QueryClientProvider>,
  );
  return onToast;
}

beforeEach(() => {
  api.emit = null;
  api.listAlertRules.mockResolvedValue(rules);
  api.getActiveAlerts.mockResolvedValue([]);
  api.setAlertRuleEnabled.mockResolvedValue();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("AlertsPage", () => {
  it("lists every rule with its switch and has no way to add one", async () => {
    renderPage();
    const thermal = await screen.findByRole("switch", {
      name: "Thermal pressure Serious",
    });
    expect(thermal.getAttribute("aria-checked")).toBe("true");
    expect(
      screen.getByRole("switch", { name: "Memory pressure Warning" }).getAttribute("aria-checked"),
    ).toBe("false");
    expect(screen.getByText("Nothing is firing.")).toBeTruthy();
    expect(screen.queryByText(/add a rule/i)).toBeNull();
  });

  it("toggling a rule calls the command and moves the switch", async () => {
    renderPage();
    const sw = await screen.findByRole("switch", {
      name: "Memory pressure Warning",
    });
    fireEvent.click(sw);
    await act(async () => {});
    expect(api.setAlertRuleEnabled).toHaveBeenCalledExactlyOnceWith("memoryPressure", true);
    expect(sw.getAttribute("aria-checked")).toBe("true");
  });

  it("leaves the switch where it was when Rust refuses", async () => {
    api.setAlertRuleEnabled.mockRejectedValue(new Error("no"));
    renderPage();
    const sw = await screen.findByRole("switch", {
      name: "Memory pressure Warning",
    });
    fireEvent.click(sw);
    await act(async () => {});
    expect(sw.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByRole("alert").textContent).toContain("Couldn't change");
  });

  it("shows a firing alert with its culprit and a guarded two-step kill", async () => {
    api.getActiveAlerts.mockResolvedValue([firing]);
    const kill = vi.spyOn(machine, "killProcess").mockResolvedValue("terminated");
    const onToast = renderPage();
    const first = await screen.findByRole("button", { name: "Kill ollama" });
    expect(screen.getByText("Serious · ollama")).toBeTruthy();
    fireEvent.click(first);
    expect(kill).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm: kill ollama" }));
    await act(async () => {});
    expect(kill).toHaveBeenCalledExactlyOnceWith({ pid: 321, startedAt: 1757 });
    expect(onToast).toHaveBeenCalledWith({
      message: "ollama stopped",
      command: null,
    });
  });

  it("shows no ✕ for a culprit Rust says is not killable", async () => {
    api.getActiveAlerts.mockResolvedValue([
      { ...firing, culprit: { ...firing.culprit!, killable: false } },
    ]);
    renderPage();
    await screen.findByText("Serious · ollama");
    expect(screen.queryByRole("button", { name: /Kill ollama/ })).toBeNull();
  });

  it("follows alerts-changed: new alert appears and the rule reads Firing", async () => {
    renderPage();
    await screen.findByText("Nothing is firing.");
    api.listAlertRules.mockResolvedValue([{ ...rules[0], firing: true }, rules[1]]);
    await act(async () => {
      api.emit?.([firing]);
    });
    expect(await screen.findByRole("button", { name: "Kill ollama" })).toBeTruthy();
    expect(screen.getByText("Firing")).toBeTruthy();
    expect(screen.queryByText("Nothing is firing.")).toBeNull();
  });
});
