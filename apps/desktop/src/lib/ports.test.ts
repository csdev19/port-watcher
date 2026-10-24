import { describe, expect, it, vi } from "vitest";
import { inTauri, killPort, listPorts } from "./ports";
import { MOCK_PORTS } from "./mock-ports";

// jsdom has no __TAURI_INTERNALS__, so these tests exercise exactly what a
// plain browser tab gets: the mock path.
describe("ports client outside tauri", () => {
  it("detects it is not inside tauri", () => {
    expect(inTauri).toBe(false);
  });

  it("lists the mock ports", async () => {
    await expect(listPorts()).resolves.toEqual(MOCK_PORTS);
  });

  it("mock kill resolves terminated for killable rows", async () => {
    await expect(killPort(MOCK_PORTS[0])).resolves.toBe("terminated");
  });

  it("mock kill resolves permissionDenied for non-killable rows", async () => {
    const locked = MOCK_PORTS.find((p) => !p.killable)!;
    await expect(killPort(locked)).resolves.toBe("permissionDenied");
  });
});

describe("inside tauri", () => {
  it("quitApp invokes the quit_app command", async () => {
    vi.resetModules();
    const invoke = vi.fn().mockResolvedValue(undefined);
    vi.doMock("@tauri-apps/api/core", () => ({ invoke }));
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    try {
      const fresh = await import("./ports");
      expect(fresh.inTauri).toBe(true);
      await fresh.quitApp();
      expect(invoke).toHaveBeenCalledWith("quit_app");
    } finally {
      delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
      vi.doUnmock("@tauri-apps/api/core");
      vi.resetModules();
    }
  });
});
