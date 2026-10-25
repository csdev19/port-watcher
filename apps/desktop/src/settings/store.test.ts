import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getSetting,
  hasSetting,
  resetMemorySettings,
  setSetting,
  SETTINGS_DEFAULTS,
  subscribeSetting,
} from "./store";

afterEach(() => resetMemorySettings());

describe("settings store (outside Tauri)", () => {
  it("defaults appearance to system", async () => {
    expect(await getSetting("appearance")).toBe("system");
  });

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

describe("alert and watched-port settings", () => {
  it("default rules are thermal, hotspot and memory; the optional ones are off", () => {
    expect({
      thermal: SETTINGS_DEFAULTS.alertThermalPressure,
      hotspot: SETTINGS_DEFAULTS.alertHotspot,
      memory: SETTINGS_DEFAULTS.alertMemoryPressure,
      cpu: SETTINGS_DEFAULTS.alertCpuSustained,
      gpu: SETTINGS_DEFAULTS.alertGpuSustained,
      port: SETTINGS_DEFAULTS.alertWatchedPortTaken,
    }).toEqual({ thermal: true, hotspot: true, memory: true, cpu: false, gpu: false, port: false });
  });

  it("a watched-ports default does not count as written (the import relies on it)", async () => {
    expect(await getSetting("favourites")).toEqual([]);
    expect(await hasSetting("favourites")).toBe(false);
    await setSetting("favourites", []);
    expect(await hasSetting("favourites")).toBe(true);
  });
});

describe("useSetting warm cache", () => {
  it("renders the last known value on the first frame", async () => {
    const { renderHook } = await import("@testing-library/react");
    const { useSetting } = await import("./store");
    window.localStorage.setItem("chapay.settings.showAppsAndSystem", "false");
    const { result } = renderHook(() => useSetting("showAppsAndSystem"));
    expect(result.current[0]).toBe(false);
  });
});
