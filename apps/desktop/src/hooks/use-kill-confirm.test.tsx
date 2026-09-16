import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useKillConfirm } from "./use-kill-confirm";

describe("useKillConfirm", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("first trigger arms, second confirms", () => {
    const onConfirm = vi.fn();
    const { result } = renderHook(() => useKillConfirm(onConfirm));
    act(() => result.current.trigger());
    expect(result.current.armed).toBe(true);
    expect(onConfirm).not.toHaveBeenCalled();
    act(() => result.current.trigger());
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(result.current.armed).toBe(false);
  });

  it("disarms itself after 2 seconds", () => {
    const onConfirm = vi.fn();
    const { result } = renderHook(() => useKillConfirm(onConfirm));
    act(() => result.current.trigger());
    act(() => vi.advanceTimersByTime(2000));
    expect(result.current.armed).toBe(false);
    // A trigger after the window re-arms instead of confirming
    act(() => result.current.trigger());
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
