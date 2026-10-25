import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FocusTarget } from "@/lib/alerts";

const api = vi.hoisted(() => ({
  handler: null as ((payload: FocusTarget) => void) | null,
  event: "",
  unlisten: vi.fn(),
}));

vi.mock("@/lib/alerts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/alerts")>()),
  listenTo: (event: string, cb: (payload: FocusTarget) => void) => {
    api.event = event;
    api.handler = cb;
    return api.unlisten;
  },
}));

import { useAlertFocus } from "./use-alert-focus";

afterEach(() => vi.clearAllMocks());

describe("useAlertFocus", () => {
  it("passes the target of an alert-focus event to the latest callback", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => useAlertFocus(cb), { initialProps: { cb: first } });
    expect(api.event).toBe("alert-focus");
    rerender({ cb: second });
    api.handler?.({ kind: "port", port: 5173 });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledExactlyOnceWith({ kind: "port", port: 5173 });
  });

  it("unsubscribes on unmount", () => {
    const { unmount } = renderHook(() => useAlertFocus(() => {}));
    unmount();
    expect(api.unlisten).toHaveBeenCalled();
  });
});
