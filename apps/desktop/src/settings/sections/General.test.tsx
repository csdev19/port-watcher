import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import General from "./General";
import { getSetting, resetMemorySettings } from "../store";

const native = vi.hoisted(() => ({
  registerShortcut: vi.fn<(s: string) => Promise<void>>(),
  getAutostart: vi.fn<() => Promise<boolean>>(),
  setAutostart: vi.fn<(on: boolean) => Promise<void>>(),
  setAlertRuleEnabled: vi.fn<(rule: string, on: boolean) => Promise<void>>(),
}));
vi.mock("../native", () => native);

function press(init: KeyboardEventInit) {
  fireEvent.keyDown(window, init);
}

beforeEach(() => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  native.registerShortcut.mockResolvedValue();
  native.getAutostart.mockResolvedValue(false);
  native.setAutostart.mockResolvedValue();
  native.setAlertRuleEnabled.mockResolvedValue();
});

afterEach(() => {
  cleanup();
  resetMemorySettings();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

function startRecording() {
  render(<General />);
  fireEvent.click(screen.getByRole("button", { name: "Change" }));
  screen.getByText("Press a shortcut…");
}

describe("General: shortcut recorder", () => {
  it("shows the current shortcut as keycaps", () => {
    render(<General />);
    expect(screen.getAllByText(/^(⌥|⌘|P)$/).map((k) => k.textContent)).toEqual(["⌥", "⌘", "P"]);
  });

  it("saves and registers a valid combination", async () => {
    startRecording();
    press({ code: "KeyK", altKey: true, metaKey: true });
    await waitFor(async () => expect(await getSetting("shortcut")).toBe("alt+cmd+k"));
    expect(native.registerShortcut).toHaveBeenCalledWith("alt+cmd+k");
    expect(screen.queryByText("Press a shortcut…")).toBeNull();
  });

  it("ignores a lone modifier and keeps recording", () => {
    startRecording();
    press({ code: "MetaLeft", metaKey: true });
    screen.getByText("Press a shortcut…");
    expect(native.registerShortcut).not.toHaveBeenCalled();
  });

  it("cancels on Esc and keeps the old shortcut", async () => {
    startRecording();
    press({ code: "Escape" });
    expect(screen.queryByText("Press a shortcut…")).toBeNull();
    expect(native.registerShortcut).not.toHaveBeenCalled();
    expect(await getSetting("shortcut")).toBe("alt+cmd+p");
  });

  it("refuses a key with no modifier, inline", () => {
    startRecording();
    press({ code: "KeyP" });
    expect(screen.getByRole("alert").textContent).toBe("Add at least one modifier: ⌘, ⌥, ⌃ or ⇧.");
    expect(native.registerShortcut).not.toHaveBeenCalled();
    screen.getByText("Press a shortcut…");
  });

  it("refuses a macOS system shortcut, inline", () => {
    startRecording();
    press({ code: "Space", metaKey: true });
    expect(screen.getByRole("alert").textContent).toBe("⌘Space is used by macOS.");
    expect(native.registerShortcut).not.toHaveBeenCalled();
  });

  it("keeps the old shortcut when Rust refuses the new one", async () => {
    native.registerShortcut.mockRejectedValue(new Error("already registered"));
    startRecording();
    press({ code: "KeyK", altKey: true, metaKey: true });
    await screen.findByText("Another app already uses ⌥⌘K.");
    expect(await getSetting("shortcut")).toBe("alt+cmd+p");
  });
});

describe("General: launch at login", () => {
  it("reads the OS state on mount", async () => {
    native.getAutostart.mockResolvedValue(true);
    render(<General />);
    await waitFor(() =>
      expect(
        screen.getByRole("switch", { name: "Launch at login" }).getAttribute("aria-checked"),
      ).toBe("true"),
    );
  });

  it("reverts the switch and explains when the OS refuses", async () => {
    native.setAutostart.mockRejectedValue(new Error("denied"));
    render(<General />);
    const toggle = screen.getByRole("switch", { name: "Launch at login" });
    await waitFor(() => expect((toggle as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(toggle);
    await screen.findByText("Couldn't turn launch at login on. Try again.");
    expect(toggle.getAttribute("aria-checked")).toBe("false");
  });
});

describe("General: automatic update check", () => {
  it("is on by default and saves when turned off", async () => {
    render(<General />);
    const toggle = screen.getByRole("switch", { name: "Check for updates automatically" });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    screen.getByText("Once when chapay opens, then daily. Nothing else is sent.");
    // Let the stored value load first, as a user's click always would.
    await act(async () => {});
    fireEvent.click(toggle);
    await waitFor(async () => expect(await getSetting("autoCheckUpdates")).toBe(false));
    expect(toggle.getAttribute("aria-checked")).toBe("false");
  });
});

describe("General: refresh interval", () => {
  it("saves the chosen interval", async () => {
    render(<General />);
    fireEvent.change(screen.getByRole("combobox", { name: "Refresh while open" }), {
      target: { value: "5000" },
    });
    await waitFor(async () => expect(await getSetting("refreshIntervalMs")).toBe(5000));
  });
});

describe("General: appearance", () => {
  it("shows System / Dark / Light as radios with System selected", () => {
    render(<General />);
    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => r.textContent)).toEqual(["System", "Dark", "Light"]);
    expect(screen.getByRole("radio", { name: "System" }).getAttribute("aria-checked")).toBe("true");
  });

  it("persists the choice on click", async () => {
    render(<General />);
    await act(async () => {}); // let the initial store read settle
    fireEvent.click(screen.getByRole("radio", { name: "Light" }));
    await waitFor(async () => expect(await getSetting("appearance")).toBe("light"));
    expect(screen.getByRole("radio", { name: "Light" }).getAttribute("aria-checked")).toBe("true");
  });

  it("moves the selection with the arrow keys", async () => {
    render(<General />);
    fireEvent.keyDown(screen.getByRole("radio", { name: "System" }), { key: "ArrowRight" });
    await waitFor(async () => expect(await getSetting("appearance")).toBe("dark"));
    fireEvent.keyDown(screen.getByRole("radio", { name: "Dark" }), { key: "ArrowLeft" });
    await waitFor(async () => expect(await getSetting("appearance")).toBe("system"));
  });
});

describe("General: alerts", () => {
  const switches = [
    ["Thermal pressure", "thermalPressure", true],
    ["CPU hotspot over 95 °C", "hotspot", true],
    ["Memory pressure", "memoryPressure", true],
    ["CPU over 80% for 2 min", "cpuSustained", false],
    ["GPU over 90% for 2 min", "gpuSustained", false],
  ] as const;

  it("lists the five rules with the default rules on", () => {
    render(<General />);
    for (const [label, , on] of switches) {
      const sw = screen.getByRole("switch", { name: label });
      expect(sw.getAttribute("aria-checked")).toBe(String(on));
    }
  });

  it("a toggle asks Rust first, then the setting follows", async () => {
    render(<General />);
    fireEvent.click(screen.getByRole("switch", { name: "CPU over 80% for 2 min" }));
    expect(native.setAlertRuleEnabled).toHaveBeenCalledExactlyOnceWith("cpuSustained", true);
  });

  it("a refused toggle leaves the switch unchanged and says so", async () => {
    native.setAlertRuleEnabled.mockRejectedValue(new Error("engine is not running"));
    render(<General />);
    const sw = screen.getByRole("switch", { name: "Thermal pressure" });
    fireEvent.click(sw);
    await waitFor(() => expect(screen.getByText(/Couldn't turn this alert off/)).toBeTruthy());
    expect(sw.getAttribute("aria-checked")).toBe("true");
  });
});
