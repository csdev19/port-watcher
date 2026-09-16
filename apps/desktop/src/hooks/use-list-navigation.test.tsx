import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useListNavigation } from "./use-list-navigation";
import type { PortEntry } from "@/lib/types";

const key = (k: string, meta = false) =>
  new KeyboardEvent("keydown", { key: k, metaKey: meta, cancelable: true });

// Minimal PortEntry-shaped fakes — only pid/port matter for selection identity.
const fakeEntries = (n: number): PortEntry[] =>
  Array.from({ length: n }, (_, i) => ({
    port: 3000 + i,
    pid: 100 + i,
    processName: "node",
    command: "node app.js",
    cwd: null,
    project: null,
    label: `entry-${i}`,
    user: null,
    startedAt: 0,
    memoryBytes: 0,
    killable: true,
  }));

const keyOf = (e: PortEntry) => `${e.pid}:${e.port}`;

describe("useListNavigation", () => {
  it("arrows move and clamp at both ends", () => {
    const entries = fakeEntries(3);
    const { result } = renderHook(() => useListNavigation(entries));
    expect(result.current.selectedKey).toBe(keyOf(entries[0])); // starts on first entry
    act(() => void result.current.onKeyDown(key("ArrowUp")));
    expect(result.current.selectedKey).toBe(keyOf(entries[0])); // clamped at top
    act(() => void result.current.onKeyDown(key("ArrowDown")));
    act(() => void result.current.onKeyDown(key("ArrowDown")));
    act(() => void result.current.onKeyDown(key("ArrowDown")));
    expect(result.current.selectedKey).toBe(keyOf(entries[2])); // clamped at bottom
  });

  it("maps enter, cmd+backspace and escape to actions", () => {
    const entries = fakeEntries(3);
    const { result } = renderHook(() => useListNavigation(entries));
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
    const entries = fakeEntries(3);
    const { result } = renderHook(() => useListNavigation(entries));
    act(() => result.current.setSelectedKey(keyOf(entries[2])));
    expect(result.current.selectedKey).toBe(keyOf(entries[2]));
  });

  it("a selection whose entry disappears is not silently reassigned to another row", () => {
    const entries = fakeEntries(3);
    const { result, rerender } = renderHook(({ entries }) => useListNavigation(entries), {
      initialProps: { entries },
    });
    act(() => result.current.setSelectedKey(keyOf(entries[1])));
    expect(result.current.selectedKey).toBe(keyOf(entries[1]));

    // Simulate a poll/filter that drops the selected row.
    const narrowed = [entries[0], entries[2]];
    rerender({ entries: narrowed });

    // The stale key stays as-is (no crash, no reassignment) — App.tsx is
    // responsible for treating "key not found in entries" as "nothing
    // highlighted" when deriving the index it passes down.
    expect(result.current.selectedKey).toBe(keyOf(entries[1]));
    expect(narrowed.some((e) => keyOf(e) === result.current.selectedKey)).toBe(false);
  });
});
