import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActiveAlert } from "@/lib/alerts";

const api = vi.hoisted(() => ({
  getActiveAlerts: vi.fn<() => Promise<ActiveAlert[]>>(),
  handler: null as ((payload: ActiveAlert[]) => void) | null,
  unlisten: vi.fn(),
}));

vi.mock("@/lib/alerts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/alerts")>()),
  getActiveAlerts: api.getActiveAlerts,
  listenTo: (_event: string, cb: (payload: ActiveAlert[]) => void) => {
    api.handler = cb;
    return api.unlisten;
  },
}));

import { useActiveAlerts } from "./use-active-alerts";

const firing: ActiveAlert = {
  id: "health:hotspot",
  rule: "hotspot",
  level: "stop",
  title: "CPU hotspot over 95 °C",
  reading: "97 °C",
  culprit: null,
  sinceEpochMs: 1,
  target: null,
};

afterEach(() => {
  api.handler = null;
  vi.clearAllMocks();
});

describe("useActiveAlerts", () => {
  it("starts with what is firing and follows alerts-changed", async () => {
    api.getActiveAlerts.mockResolvedValue([firing]);
    const { result } = renderHook(() => useActiveAlerts());
    expect(result.current).toEqual([]);
    await waitFor(() => expect(result.current).toEqual([firing]));
    act(() => api.handler?.([]));
    expect(result.current).toEqual([]);
  });

  it("an event that beats the first read is not overwritten by it", async () => {
    let resolve!: (v: ActiveAlert[]) => void;
    api.getActiveAlerts.mockReturnValue(new Promise((r) => (resolve = r)));
    const { result } = renderHook(() => useActiveAlerts());
    act(() => api.handler?.([firing]));
    await act(async () => resolve([]));
    expect(result.current).toEqual([firing]);
  });

  it("stops listening on unmount", () => {
    api.getActiveAlerts.mockResolvedValue([]);
    const { unmount } = renderHook(() => useActiveAlerts());
    unmount();
    expect(api.unlisten).toHaveBeenCalled();
  });
});
