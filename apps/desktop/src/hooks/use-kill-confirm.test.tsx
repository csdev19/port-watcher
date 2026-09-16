import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useKillConfirm } from "./use-kill-confirm";
import type { PortEntry } from "@/lib/types";

const devEntry: PortEntry = {
  port: 3000,
  pid: 100,
  processName: "node",
  command: "node app.js",
  cwd: null,
  project: null,
  label: "dev",
  user: "dev",
  startedAt: 1000,
  memoryBytes: 0,
  killable: true,
  category: "dev",
  executablePath: null,
  appBundlePath: null,
};

const systemEntry: PortEntry = {
  ...devEntry,
  port: 7000,
  pid: 88,
  label: "ControlCenter",
  category: "system",
};

const lockedEntry: PortEntry = { ...devEntry, port: 9000, pid: 55, killable: false };

describe("useKillConfirm", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("pointer request on dev: first arms, second confirms", () => {
    const onConfirm = vi.fn();
    const { result } = renderHook(() => useKillConfirm(onConfirm));
    act(() => result.current.request(devEntry, "pointer"));
    expect(result.current.armedTarget).toEqual({
      key: "100:3000",
      startedAt: 1000,
      category: "dev",
    });
    expect(onConfirm).not.toHaveBeenCalled();
    act(() => result.current.request(devEntry, "pointer"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith(devEntry);
    expect(result.current.armedTarget).toBeNull();
  });

  it("keyboard request on dev confirms immediately, no arming", () => {
    const onConfirm = vi.fn();
    const { result } = renderHook(() => useKillConfirm(onConfirm));
    act(() => result.current.request(devEntry, "keyboard"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(result.current.armedTarget).toBeNull();
  });

  it("keyboard request on system arms like a protected request", () => {
    const onConfirm = vi.fn();
    const { result } = renderHook(() => useKillConfirm(onConfirm));
    act(() => result.current.request(systemEntry, "keyboard"));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(result.current.armedTarget).toEqual({
      key: "88:7000",
      startedAt: 1000,
      category: "system",
    });
    act(() => result.current.request(systemEntry, "keyboard"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("pointer arm then keyboard confirm on the same target (mixed input)", () => {
    const onConfirm = vi.fn();
    const { result } = renderHook(() => useKillConfirm(onConfirm));
    act(() => result.current.request(systemEntry, "pointer"));
    expect(onConfirm).not.toHaveBeenCalled();
    act(() => result.current.request(systemEntry, "keyboard"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("request on an unkillable entry disarms and never calls back", () => {
    const onConfirm = vi.fn();
    const { result } = renderHook(() => useKillConfirm(onConfirm));
    act(() => result.current.request(systemEntry, "pointer"));
    expect(result.current.armedTarget).not.toBeNull();
    act(() => result.current.request(lockedEntry, "pointer"));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(result.current.armedTarget).toBeNull();
  });

  it("a request for a different key replaces the armed target and restarts the timer", () => {
    const onConfirm = vi.fn();
    const { result } = renderHook(() => useKillConfirm(onConfirm));
    act(() => result.current.request(devEntry, "pointer"));
    act(() => vi.advanceTimersByTime(1500));
    act(() => result.current.request(systemEntry, "pointer"));
    expect(result.current.armedTarget).toEqual({
      key: "88:7000",
      startedAt: 1000,
      category: "system",
    });
    // The old target cannot confirm anymore.
    act(() => vi.advanceTimersByTime(600));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(result.current.armedTarget).not.toBeNull(); // still within its own fresh window
  });

  it("a request for the same key but a different incarnation (startedAt) never confirms the stale arm", () => {
    const onConfirm = vi.fn();
    const { result } = renderHook(() => useKillConfirm(onConfirm));
    act(() => result.current.request(systemEntry, "pointer"));
    const restarted = { ...systemEntry, startedAt: 2000 };
    act(() => result.current.request(restarted, "pointer"));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(result.current.armedTarget).toEqual({
      key: "88:7000",
      startedAt: 2000,
      category: "system",
    });
  });

  it("disarms itself after 2 seconds", () => {
    const onConfirm = vi.fn();
    const { result } = renderHook(() => useKillConfirm(onConfirm));
    act(() => result.current.request(systemEntry, "pointer"));
    act(() => vi.advanceTimersByTime(2000));
    expect(result.current.armedTarget).toBeNull();
    // A request after the window re-arms instead of confirming.
    act(() => result.current.request(systemEntry, "pointer"));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(result.current.armedTarget).not.toBeNull();
  });

  it("disarm() clears the armed target and its timer", () => {
    const onConfirm = vi.fn();
    const { result } = renderHook(() => useKillConfirm(onConfirm));
    act(() => result.current.request(systemEntry, "pointer"));
    act(() => result.current.disarm());
    expect(result.current.armedTarget).toBeNull();
    act(() => vi.advanceTimersByTime(5000));
    act(() => result.current.request(systemEntry, "pointer"));
    // Disarming reset the state, so this request re-arms rather than confirming.
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("cleans up the timer on unmount", () => {
    const onConfirm = vi.fn();
    const { result, unmount } = renderHook(() => useKillConfirm(onConfirm));
    act(() => result.current.request(systemEntry, "pointer"));
    unmount();
    act(() => vi.advanceTimersByTime(5000));
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
