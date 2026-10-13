import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Permissions, { RECHECK_INTERVAL_MS } from "./Permissions";
import * as setupLib from "@/lib/setup";

vi.mock("@/lib/setup", () => ({
  checkFullDiskAccess: vi.fn(async () => false),
  openFullDiskAccessSettings: vi.fn(async () => {}),
  showSetupWindow: vi.fn(async () => {}),
}));

const check = vi.mocked(setupLib.checkFullDiskAccess);

async function flush() {
  await act(async () => {});
}

beforeEach(() => {
  vi.useFakeTimers();
  check.mockReset();
  check.mockResolvedValue(false);
  vi.mocked(setupLib.openFullDiskAccessSettings).mockClear();
  vi.mocked(setupLib.showSetupWindow).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Permissions", () => {
  it("shows Off and a Turn on button that opens the Full Disk Access pane", async () => {
    render(<Permissions />);
    await flush();
    expect(screen.getByText("Off")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }));
    expect(setupLib.openFullDiskAccessSettings).toHaveBeenCalledTimes(1);
  });

  it("shows On and a Manage button that opens the same pane", async () => {
    check.mockResolvedValue(true);
    render(<Permissions />);
    await flush();
    expect(screen.getByText("On")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Turn on" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Manage" }));
    expect(setupLib.openFullDiskAccessSettings).toHaveBeenCalledTimes(1);
  });

  it("does not render a Notifications row", async () => {
    render(<Permissions />);
    await flush();
    expect(screen.queryByText("Notifications")).toBeNull();
  });

  it("re-checks when the window regains focus", async () => {
    render(<Permissions />);
    await flush();
    expect(screen.getByText("Off")).toBeTruthy();
    check.mockResolvedValue(true);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(screen.getByText("On")).toBeTruthy();
  });

  it("re-checks every 2 seconds and stops after unmount", async () => {
    const { unmount } = render(<Permissions />);
    await flush();
    check.mockResolvedValue(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RECHECK_INTERVAL_MS);
    });
    expect(screen.getByText("On")).toBeTruthy();
    unmount();
    check.mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RECHECK_INTERVAL_MS * 3);
    });
    expect(check).not.toHaveBeenCalled();
  });

  it("opens the first-run window from the note card", async () => {
    render(<Permissions />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Show the first-run window again" }));
    expect(setupLib.showSetupWindow).toHaveBeenCalledTimes(1);
  });
});
