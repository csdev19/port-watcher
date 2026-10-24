import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("./ports");
  vi.doUnmock("@tauri-apps/api/window");
});

const flush = () => new Promise((r) => setTimeout(r, 0));

async function load(inTauri: boolean) {
  vi.resetModules();
  vi.doMock("./ports", () => ({ inTauri }));
  const setTheme = vi.fn(async () => {});
  vi.doMock("@tauri-apps/api/window", () => ({
    getCurrentWindow: () => ({
      setTheme,
      theme: async () => "dark",
      onThemeChanged: async () => () => {},
    }),
  }));
  const mod = await import("./appearance");
  return { ...mod, setTheme };
}

describe("applyAppearance", () => {
  it("sets data-theme for dark and light, clears it for system", async () => {
    const root = document.createElement("html");
    const { applyAppearance } = await load(false);
    applyAppearance("dark", root);
    expect(root.dataset.theme).toBe("dark");
    applyAppearance("light", root);
    expect(root.dataset.theme).toBe("light");
    applyAppearance("system", root);
    expect(root.dataset.theme).toBeUndefined();
  });

  it("sets the native window theme in Tauri: dark, light, null for system", async () => {
    const root = document.createElement("html");
    const { applyAppearance, setTheme } = await load(true);
    applyAppearance("dark", root);
    await flush();
    applyAppearance("light", root);
    await flush();
    applyAppearance("system", root)();
    await flush();
    expect(setTheme.mock.calls).toEqual([["dark"], ["light"], [null]]);
  });

  it("does not touch the window outside Tauri", async () => {
    const { applyAppearance, setTheme } = await load(false);
    applyAppearance("light", document.createElement("html"));
    await flush();
    expect(setTheme).not.toHaveBeenCalled();
  });

  it("keeps the page themed when setTheme is refused", async () => {
    const root = document.createElement("html");
    const { applyAppearance, setTheme } = await load(true);
    setTheme.mockRejectedValue(new Error("not allowed"));
    applyAppearance("light", root);
    await flush();
    expect(root.dataset.theme).toBe("light");
  });
});
