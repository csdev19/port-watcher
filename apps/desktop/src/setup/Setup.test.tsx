import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Setup, { POLL_INTERVAL_MS } from "./Setup";
import * as setupLib from "@/lib/setup";

vi.mock("@/lib/setup", () => ({
  checkFullDiskAccess: vi.fn(async () => false),
  openFullDiskAccessSettings: vi.fn(async () => {}),
  finishSetup: vi.fn(async () => {}),
}));

const check = vi.mocked(setupLib.checkFullDiskAccess);

/** Flush pending promise callbacks without advancing fake timers. */
async function flush() {
  await act(async () => {});
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function goToWaiting() {
  fireEvent.click(screen.getByRole("button", { name: /allow folder access/i }));
  await flush();
}

beforeEach(() => {
  vi.useFakeTimers();
  check.mockReset();
  check.mockResolvedValue(false);
  vi.mocked(setupLib.openFullDiskAccessSettings).mockClear();
  vi.mocked(setupLib.finishSetup).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Setup", () => {
  it("starts on Welcome with the exact setting name and a single primary action", () => {
    render(<Setup />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("See what’s on your ports.");
    expect(screen.getByText("Full Disk Access").tagName).toBe("STRONG");
    expect(screen.getByText("package.json").tagName).toBe("CODE");
    expect(screen.getByText("Optional")).toBeTruthy();
    expect(screen.getAllByText("Vite")).toHaveLength(2);
    expect(screen.getByRole("img", { name: "Step 1 of 2" })).toBeTruthy();
    expect(check).not.toHaveBeenCalled();
  });

  it("Allow opens System Settings and moves to Waiting", async () => {
    render(<Setup />);
    await goToWaiting();
    expect(setupLib.openFullDiskAccessSettings).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Turn on chapay in System Settings")).toBeTruthy();
    expect(screen.getByText("Waiting for access")).toBeTruthy();
    const waiting = screen.getByRole("button", { name: /waiting/i });
    expect((waiting as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("img", { name: "Step 1 of 2" })).toBeTruthy();
  });

  it("Waiting polls every second and moves to Done once access is granted", async () => {
    render(<Setup />);
    await goToWaiting();
    expect(check).toHaveBeenCalledTimes(1);
    await advance(POLL_INTERVAL_MS);
    expect(check).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("You’re set.")).toBeNull();

    check.mockResolvedValue(true);
    await advance(POLL_INTERVAL_MS);
    expect(screen.getByText("You’re set.")).toBeTruthy();
    expect(screen.getByText(/Folder access is on/)).toBeTruthy();
    expect(screen.getByRole("img", { name: "Step 2 of 2" })).toBeTruthy();

    // Polling stops once Done is shown.
    const calls = check.mock.calls.length;
    await advance(POLL_INTERVAL_MS * 3);
    expect(check).toHaveBeenCalledTimes(calls);
  });

  it("Not now on Welcome goes to Skipped without polling", async () => {
    render(<Setup />);
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    await flush();
    expect(screen.getByText("You’re set.")).toBeTruthy();
    expect(screen.getByText(/Project names stay hidden/)).toBeTruthy();
    expect(screen.getByText(/Folder access…/)).toBeTruthy();
    expect(check).not.toHaveBeenCalled();
    expect(setupLib.openFullDiskAccessSettings).not.toHaveBeenCalled();
  });

  it("Not now on Waiting goes to Skipped and stops polling", async () => {
    render(<Setup />);
    await goToWaiting();
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    await flush();
    expect(screen.getByText(/Project names stay hidden/)).toBeTruthy();
    const calls = check.mock.calls.length;
    await advance(POLL_INTERVAL_MS * 3);
    expect(check).toHaveBeenCalledTimes(calls);
  });

  it("Open chapay asks Rust to close the window and open the panel", async () => {
    render(<Setup />);
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Open chapay" }));
    expect(setupLib.finishSetup).toHaveBeenCalledTimes(1);
  });

  it("stops polling when unmounted", async () => {
    const { unmount } = render(<Setup />);
    await goToWaiting();
    unmount();
    const calls = check.mock.calls.length;
    await advance(POLL_INTERVAL_MS * 3);
    expect(check).toHaveBeenCalledTimes(calls);
  });
});
