import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useListNavigation } from "./use-list-navigation";

const key = (k: string, meta = false) =>
  new KeyboardEvent("keydown", { key: k, metaKey: meta, cancelable: true });

describe("useListNavigation", () => {
  it("arrows move and clamp at both ends", () => {
    const { result } = renderHook(() => useListNavigation(3));
    act(() => void result.current.onKeyDown(key("ArrowUp")));
    expect(result.current.selected).toBe(0); // clamped at top
    act(() => void result.current.onKeyDown(key("ArrowDown")));
    act(() => void result.current.onKeyDown(key("ArrowDown")));
    act(() => void result.current.onKeyDown(key("ArrowDown")));
    expect(result.current.selected).toBe(2); // clamped at bottom
  });

  it("maps enter, cmd+backspace and escape to actions", () => {
    const { result } = renderHook(() => useListNavigation(3));
    expect(result.current.onKeyDown(key("Enter"))).toBe("expand");
    expect(result.current.onKeyDown(key("Backspace", true))).toBe("kill");
    expect(result.current.onKeyDown(key("Backspace"))).toBe(null);
    expect(result.current.onKeyDown(key("Escape"))).toBe("close");
  });

  it("empty list keeps selection at 0", () => {
    const { result } = renderHook(() => useListNavigation(0));
    act(() => void result.current.onKeyDown(key("ArrowDown")));
    expect(result.current.selected).toBe(0);
  });
});
