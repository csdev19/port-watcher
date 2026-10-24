import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TopProcesses } from "./TopProcesses";
import { MOCK_TOP } from "@/lib/mock-machine";
import * as machine from "@/lib/machine";

function renderTop(onToast = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TopProcesses cores={12} cpuWarn={80} onToast={onToast} />
    </QueryClientProvider>,
  );
  return onToast;
}

describe("TopProcesses", () => {
  beforeEach(() => {
    vi.spyOn(machine, "topProcesses").mockResolvedValue(MOCK_TOP);
  });
  afterEach(() => vi.restoreAllMocks());

  it("lists the groups with sub-line and a lock on the system row", async () => {
    renderTop();
    await screen.findByText("Cursor Helper (Renderer)");
    expect(screen.getByText("Cursor · 4 processes")).toBeTruthy();
    expect(screen.getByRole("img", { name: "macOS system process" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Kill WindowServer/ })).toBeNull();
  });

  it("needs two clicks to kill, and sends the target's pid and start time", async () => {
    const kill = vi.spyOn(machine, "killProcess").mockResolvedValue("terminated");
    const onToast = renderTop();
    await screen.findByText("Cursor Helper (Renderer)");
    fireEvent.click(screen.getByRole("button", { name: "Kill Cursor" }));
    expect(kill).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm: kill Cursor" }));
    await waitFor(() => expect(kill).toHaveBeenCalledTimes(1));
    expect(kill).toHaveBeenCalledWith({ pid: 4101, startedAt: 1_700_000_001 });
    await waitFor(() =>
      expect(onToast).toHaveBeenCalledWith({ message: "Cursor stopped", command: null }),
    );
  });

  it("labels the armed button with the app name", async () => {
    renderTop();
    await screen.findByText("Cursor Helper (Renderer)");
    fireEvent.click(screen.getByRole("button", { name: "Kill Cursor" }));
    expect(screen.getByRole("button", { name: "Confirm: kill Cursor" }).textContent).toBe(
      "Kill Cursor?",
    );
  });

  it("⌘⌫ is two steps too: the first press only arms the selected row", async () => {
    const kill = vi.spyOn(machine, "killProcess").mockResolvedValue("terminated");
    renderTop();
    await screen.findByText("Cursor Helper (Renderer)");
    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: "Backspace", metaKey: true });
    expect(kill).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Backspace", metaKey: true });
    await waitFor(() => expect(kill).toHaveBeenCalledTimes(1));
  });

  it("reports an already-gone and a refused kill in the toast", async () => {
    const kill = vi.spyOn(machine, "killProcess").mockResolvedValueOnce("alreadyGone");
    const onToast = renderTop();
    await screen.findByText("node");
    fireEvent.click(screen.getByRole("button", { name: "Kill node" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm: kill node" }));
    await waitFor(() =>
      expect(onToast).toHaveBeenCalledWith({ message: "node was already gone", command: null }),
    );
    kill.mockResolvedValueOnce("permissionDenied");
    fireEvent.click(screen.getByRole("button", { name: "Kill vite" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm: kill vite" }));
    await waitFor(() =>
      expect(onToast).toHaveBeenCalledWith({ message: "Cannot kill vite", command: null }),
    );
  });
});

describe("TopProcesses disarm", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("disarms after the 2 s window", async () => {
    vi.spyOn(machine, "topProcesses").mockResolvedValue(MOCK_TOP);
    renderTop();
    await screen.findByText("node");
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "Kill node" }));
    expect(screen.getByRole("button", { name: "Confirm: kill node" })).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(2100);
    });
    expect(screen.getByRole("button", { name: "Kill node" })).toBeTruthy();
  });

  it("a changed process incarnation disarms, so an old arm cannot confirm a new target", async () => {
    const kill = vi.spyOn(machine, "killProcess").mockResolvedValue("terminated");
    const top = vi.spyOn(machine, "topProcesses").mockResolvedValue(MOCK_TOP);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <TopProcesses cores={12} cpuWarn={80} onToast={() => {}} />
      </QueryClientProvider>,
    );
    await screen.findByText("node");
    fireEvent.click(screen.getByRole("button", { name: "Kill node" }));
    // Same row key, a different process (pid reuse): the list refreshes underneath the arm.
    top.mockResolvedValue(
      MOCK_TOP.map((g) => (g.name === "node" ? { ...g, target: { pid: 9999, startedAt: 42 } } : g)),
    );
    await act(async () => {
      await client.invalidateQueries({ queryKey: ["top"] });
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Kill node" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Kill node" }));
    expect(kill).not.toHaveBeenCalled();
  });

  it("a locked row never arms and never calls the backend", async () => {
    const kill = vi.spyOn(machine, "killProcess");
    vi.spyOn(machine, "topProcesses").mockResolvedValue(MOCK_TOP);
    renderTop();
    await screen.findByText("WindowServer");
    fireEvent.mouseEnter(screen.getByText("WindowServer").closest("li")!);
    fireEvent.keyDown(window, { key: "Backspace", metaKey: true });
    fireEvent.keyDown(window, { key: "Backspace", metaKey: true });
    expect(kill).not.toHaveBeenCalled();
  });
});
