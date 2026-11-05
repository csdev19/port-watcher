import { afterEach, describe, expect, it, vi } from "vitest";

// `inTauri` is read once at import: mark the window as a Tauri webview
// before `./ports` loads, and capture what reaches `invoke`.
const invoke = vi.hoisted(() => {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  return vi.fn(async () => undefined);
});
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

const { openSettings } = await import("./ports");

describe("openSettings inside tauri", () => {
  afterEach(() => invoke.mockClear());

  it("passes the section to open_settings", async () => {
    await openSettings("thermal");
    expect(invoke).toHaveBeenCalledWith("open_settings", { section: "thermal" });
  });

  it("sends no section for the gear button and ⌘,", async () => {
    await openSettings();
    expect(invoke).toHaveBeenCalledWith("open_settings", { section: undefined });
  });
});
