import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryPanel } from "./MemoryPanel";
import * as memory from "@/lib/memory";
import * as ports from "@/lib/ports";

function renderPanel() {
  const onShowPort = vi.fn();
  const onNotify = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryPanel onShowPort={onShowPort} onNotify={onNotify} />
    </QueryClientProvider>,
  );
  return { onShowPort, onNotify };
}

describe("MemoryPanel", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows the verdict with its reasons and the figures", async () => {
    renderPanel();
    expect(await screen.findByText("WATCH")).toBeTruthy();
    expect(screen.getByText("Worth watching")).toBeTruthy();
    expect(
      screen.getByText(
        "macOS reports memory pressure · Swap is nearly full · One process holds a large share of RAM · A process keeps growing",
      ),
    ).toBeTruthy();
    expect(screen.getByText("21.4 GB of 24.0 GB")).toBeTruthy();
    expect(screen.getByText("9.6 GB of 12.0 GB (80%)")).toBeTruthy();
    expect(screen.getByText("5.2 GB")).toBeTruthy();
    expect(screen.getByText("Warning")).toBeTruthy();
  });

  it("lists the processes with their flags and today's chart", async () => {
    renderPanel();
    expect(await screen.findByText("zdpd")).toBeTruthy();
    expect(screen.getByText("big")).toBeTruthy();
    expect(screen.getAllByText(/^growing ×\d\.\d since /).length).toBe(2);
    expect(await screen.findByRole("img", { name: /Memory today/ })).toBeTruthy();
  });

  it("sends the port to onShowPort when its chip is clicked", async () => {
    const { onShowPort } = renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Show port 5173" }));
    expect(onShowPort).toHaveBeenCalledWith(5173);
  });

  it("shows the command card, not Kill, for a process chapay may not kill, and copies it", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderPanel();
    expect(
      await screen.findByText("sudo launchctl kickstart -k system/com.zscaler.zdpd"),
    ).toBeTruthy();
    expect(screen.getByText("Runs as root; chapay cannot stop it.")).toBeTruthy();
    expect(screen.getByText("Zscaler security software: check your IT policy.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Kill zdpd/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith("sudo launchctl kickstart -k system/com.zscaler.zdpd");
    expect(await screen.findByText("Copied")).toBeTruthy();
  });

  it("kills a killable row only after the second click, through the port kill when it has one", async () => {
    const killPort = vi.spyOn(ports, "killPort").mockResolvedValue("terminated");
    const killProcess = vi.spyOn(memory, "killProcess");
    const { onNotify } = renderPanel();
    const kill = await screen.findByRole("button", { name: "Kill node (4242)" });

    fireEvent.click(kill);
    expect(killPort).not.toHaveBeenCalled();
    expect(kill.textContent).toBe("Kill?");

    fireEvent.click(kill);
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith("node stopped"));
    expect(killPort).toHaveBeenCalledWith(expect.objectContaining({ pid: 4242, port: 5173 }));
    expect(killProcess).not.toHaveBeenCalled();
  });

  it("kills a row without a port by pid and start time", async () => {
    const killProcess = vi.spyOn(memory, "killProcess").mockResolvedValue("alreadyGone");
    const { onNotify } = renderPanel();
    const kill = await screen.findByRole("button", { name: "Kill Google Chrome Helper (777)" });
    fireEvent.click(kill);
    fireEvent.click(kill);
    await waitFor(() =>
      expect(onNotify).toHaveBeenCalledWith("Google Chrome Helper was already gone"),
    );
    expect(killProcess).toHaveBeenCalledWith(777, expect.any(Number));
  });

  it("says so when memory cannot be read", async () => {
    vi.spyOn(memory, "memoryCurrent").mockResolvedValue(null);
    renderPanel();
    expect(await screen.findByText("Memory figures are unavailable.")).toBeTruthy();
    expect(screen.queryByText("Biggest processes")).toBeNull();
  });

  it("says so when history is unavailable", async () => {
    vi.spyOn(memory, "memoryHistory").mockResolvedValue({
      available: false,
      buckets: [],
      days: [],
    });
    renderPanel();
    expect(await screen.findByText("History is unavailable right now.")).toBeTruthy();
  });
});
