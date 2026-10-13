import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getSetting,
  resetMemorySettings,
  setSetting,
  SETTINGS_DEFAULTS,
  subscribeSetting,
} from "./store";

afterEach(() => resetMemorySettings());

describe("settings store (outside Tauri)", () => {
  it("returns the default until a value is set", async () => {
    expect(await getSetting("refreshIntervalMs")).toBe(SETTINGS_DEFAULTS.refreshIntervalMs);
    await setSetting("refreshIntervalMs", 5000);
    expect(await getSetting("refreshIntervalMs")).toBe(5000);
  });

  it("notifies subscribers of that key only", async () => {
    const onShortcut = vi.fn();
    const unsubscribe = subscribeSetting("shortcut", onShortcut);
    await setSetting("confirmBeforeKill", false);
    await setSetting("shortcut", "alt+cmd+k");
    expect(onShortcut).toHaveBeenCalledExactlyOnceWith("alt+cmd+k");
    unsubscribe();
  });
});
