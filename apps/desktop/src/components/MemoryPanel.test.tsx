import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

  it("lists your processes first, with flags, and today's chart", async () => {
    renderPanel();
    expect(await screen.findByText("Yours")).toBeTruthy();
    expect(screen.getByText("node")).toBeTruthy();
    expect(screen.getByText("Google Chrome Helper")).toBeTruthy();
    // zdpd is protected, so it is hidden until the group is opened.
    expect(screen.queryByText("zdpd")).toBeNull();
    expect(await screen.findByRole("img", { name: /Memory today/ })).toBeTruthy();
  });

  it("folds the protected group, then lists rows with the reason and no Kill", async () => {
    renderPanel();
    const header = await screen.findByRole("button", { name: /^Protected · \d+ processes · / });
    expect(header.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(header);
    expect(header.getAttribute("aria-expanded")).toBe("true");

    const windowServer = screen.getByText("WindowServer").closest("li")!;
    expect(
      within(windowServer).getByText(
        "macOS system process. Stopping it can log you out or crash macOS.",
      ),
    ).toBeTruthy();
    expect(within(windowServer).queryByRole("button")).toBeNull();
    expect(screen.queryByRole("button", { name: /Kill WindowServer/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Kill zdpd/ })).toBeNull();

    const chapay = screen.getByText("chapay").closest("li")!;
    expect(within(chapay).getByText("This is chapay.")).toBeTruthy();
    // launchd is under the 50 MB floor: it needs Show all.
    expect(screen.queryByText("launchd")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    const launchd = screen.getByText("launchd").closest("li")!;
    expect(within(launchd).getByText("Core system process.")).toBeTruthy();
    // zdpd is big and growing: its flags still show.
    expect(screen.getByText("big")).toBeTruthy();
    expect(screen.getAllByText(/^growing ×\d\.\d since /).length).toBe(2);
  });

  it("opens the command card only for rows that have one, and copies it", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: /^Protected/ }));
    // Only zdpd has a command in the mock: one link, and none for system rows.
    expect(screen.getAllByRole("button", { name: /^Show command for / })).toHaveLength(1);
    expect(screen.queryByText("sudo launchctl kickstart -k system/com.zscaler.zdpd")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show command for zdpd" }));
    expect(screen.getByText("sudo launchctl kickstart -k system/com.zscaler.zdpd")).toBeTruthy();
    expect(screen.getByText("Runs as root; chapay cannot stop it.")).toBeTruthy();
    expect(screen.getByText("Zscaler security software: check your IT policy.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith("sudo launchctl kickstart -k system/com.zscaler.zdpd");
    expect(await screen.findByText("Copied")).toBeTruthy();
  });

  it("hides rows under 50 MB until Show all, and Show fewer folds them again", async () => {
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: /^Protected/ }));
    // zsh (20 MB), ssh-agent, Spotlight Helper, launchd and cfprefsd are small.
    expect(screen.queryByText("zsh")).toBeNull();
    expect(screen.queryByText("cfprefsd")).toBeNull();
    expect(screen.getByText(/^5 smaller processes ·/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(screen.getByText("zsh")).toBeTruthy();
    expect(screen.getByText("cfprefsd")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show fewer" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Show fewer" }));
    expect(screen.queryByText("zsh")).toBeNull();
  });

  it("accounts for the memory no process owns, with an explaining tooltip", async () => {
    renderPanel();
    const line = await screen.findByText(/^Not attributed to a process · /);
    expect(line.getAttribute("title")).toBe(
      "Kernel memory, compressed pages and processes chapay cannot read",
    );
  });

  it("omits the unattributed line when every byte is attributed", async () => {
    const reading = await memory.memoryCurrent();
    vi.spyOn(memory, "memoryCurrent").mockResolvedValue({ ...reading!, unattributedBytes: 0 });
    renderPanel();
    await screen.findByText("Yours");
    expect(screen.queryByText(/^Not attributed to a process/)).toBeNull();
  });

  it("sends the port to onShowPort when its chip is clicked", async () => {
    const { onShowPort } = renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Show port 5173" }));
    expect(onShowPort).toHaveBeenCalledWith(5173);
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
    expect(screen.queryByText("Yours")).toBeNull();
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
