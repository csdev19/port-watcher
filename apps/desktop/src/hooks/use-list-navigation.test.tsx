import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useListNavigation } from "./use-list-navigation";

const key = (k: string, meta = false) =>
  new KeyboardEvent("keydown", { key: k, metaKey: meta, cancelable: true });

// Row keys as App builds them (scope + pid:port); only identity matters here.
const fakeKeys = (n: number): string[] =>
  Array.from({ length: n }, (_, i) => `listening:${100 + i}:${3000 + i}`);

describe("useListNavigation", () => {
  it("arrows move and clamp at both ends", () => {
    const keys = fakeKeys(3);
    const { result } = renderHook(() => useListNavigation(keys));
    expect(result.current.selectedKey).toBe(keys[0]); // starts on first entry
    act(() => void result.current.onKeyDown(key("ArrowUp")));
    expect(result.current.selectedKey).toBe(keys[0]); // clamped at top
    act(() => void result.current.onKeyDown(key("ArrowDown")));
    act(() => void result.current.onKeyDown(key("ArrowDown")));
    act(() => void result.current.onKeyDown(key("ArrowDown")));
    expect(result.current.selectedKey).toBe(keys[2]); // clamped at bottom
  });

  it("maps enter, cmd+backspace and escape to actions", () => {
    const keys = fakeKeys(3);
    const { result } = renderHook(() => useListNavigation(keys));
    expect(result.current.onKeyDown(key("Enter"))).toBe("expand");
    expect(result.current.onKeyDown(key("Backspace", true))).toBe("kill");
    expect(result.current.onKeyDown(key("Backspace"))).toBe(null);
    expect(result.current.onKeyDown(key("Escape"))).toBe("close");
  });

  it("empty list keeps selection null", () => {
    const { result } = renderHook(() => useListNavigation([]));
    expect(result.current.selectedKey).toBeNull();
    act(() => void result.current.onKeyDown(key("ArrowDown")));
    expect(result.current.selectedKey).toBeNull();
  });

  it("setSelectedKey lets mouse hover drive selection directly", () => {
    const keys = fakeKeys(3);
    const { result } = renderHook(() => useListNavigation(keys));
    act(() => result.current.setSelectedKey(keys[2]));
    expect(result.current.selectedKey).toBe(keys[2]);
  });

  it("a selection whose entry disappears is not silently reassigned to another row", () => {
    const keys = fakeKeys(3);
    const { result, rerender } = renderHook(({ rows }) => useListNavigation(rows), {
      initialProps: { rows: keys },
    });
    act(() => result.current.setSelectedKey(keys[1]));
    expect(result.current.selectedKey).toBe(keys[1]);

    // Simulate a poll/filter that drops the selected row.
    const narrowed = [keys[0], keys[2]];
    rerender({ rows: narrowed });

    // The stale key stays as-is (no crash, no reassignment) — App.tsx is
    // responsible for treating "key not found in keys" as "nothing
    // highlighted" when deriving the index it passes down.
    expect(result.current.selectedKey).toBe(keys[1]);
    expect(narrowed.includes(result.current.selectedKey!)).toBe(false);
  });
});
