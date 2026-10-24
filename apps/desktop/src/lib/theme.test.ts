import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("./ports");
  vi.doUnmock("@tauri-apps/api/window");
});

async function load(opts: { inTauri: boolean; theme?: () => Promise<unknown> }) {
  vi.resetModules();
  vi.doMock("./ports", () => ({ inTauri: opts.inTauri }));
  let emit: (t: string) => void = () => {};
  const stop = vi.fn();
  vi.doMock("@tauri-apps/api/window", () => ({
    getCurrentWindow: () => ({
      theme: opts.theme ?? (async () => "light"),
      onThemeChanged: async (cb: (e: { payload: string }) => void) => {
        emit = (t) => cb({ payload: t });
        return stop;
      },
    }),
  }));
  const mod = await import("./theme");
  return { sync: mod.syncPanelTheme, emit: (t: string) => emit(t), stop };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("syncPanelTheme", () => {
  it("does nothing outside tauri", async () => {
    const root = document.createElement("html");
    const { sync } = await load({ inTauri: false });
    sync(root)();
    await flush();
    expect(root.dataset.theme).toBeUndefined();
  });

  it("applies the window theme and follows changes", async () => {
    const root = document.createElement("html");
    const { sync, emit } = await load({ inTauri: true });
    sync(root);
    await flush();
    expect(root.dataset.theme).toBe("light");
    emit("dark");
    expect(root.dataset.theme).toBe("dark");
  });

  it("leaves data-theme unset when the window API fails", async () => {
    const root = document.createElement("html");
    const { sync } = await load({
      inTauri: true,
      theme: async () => {
        throw new Error("not allowed");
      },
    });
    sync(root);
    await flush();
    expect(root.dataset.theme).toBeUndefined();
  });

  it("stops following after cleanup", async () => {
    const root = document.createElement("html");
    const { sync, emit, stop } = await load({ inTauri: true });
    const cleanup = sync(root);
    await flush();
    cleanup();
    expect(stop).toHaveBeenCalled();
    emit("dark");
    expect(root.dataset.theme).toBe("light");
  });
});
