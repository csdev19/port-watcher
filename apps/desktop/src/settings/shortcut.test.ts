import { describe, expect, it } from "vitest";
import { recordKey, shortcutKeys, validateShortcut } from "./shortcut";

const none = { ctrlKey: false, altKey: false, shiftKey: false, metaKey: false };

describe("recordKey", () => {
  it("maps ⌥⌘P to the plugin string", () => {
    expect(recordKey({ ...none, altKey: true, metaKey: true, code: "KeyP" }, true)).toEqual({
      kind: "combo",
      shortcut: "alt+cmd+p",
      bare: false,
    });
  });

  it("orders modifiers ctrl, alt, shift, cmd and maps digits", () => {
    const step = recordKey(
      { metaKey: true, shiftKey: true, altKey: true, ctrlKey: true, code: "Digit1" },
      true,
    );
    expect(step).toMatchObject({ shortcut: "ctrl+alt+shift+cmd+1" });
  });

  it("uses super instead of cmd off macOS", () => {
    expect(recordKey({ ...none, metaKey: true, code: "KeyK" }, false)).toMatchObject({
      shortcut: "super+k",
    });
  });

  it("ignores a lone modifier press", () => {
    expect(recordKey({ ...none, metaKey: true, code: "MetaLeft" }, true)).toEqual({
      kind: "ignore",
    });
  });

  it("cancels on a bare Esc but not on a modified one", () => {
    expect(recordKey({ ...none, code: "Escape" }, true)).toEqual({ kind: "cancel" });
    expect(recordKey({ ...none, metaKey: true, altKey: true, code: "Escape" }, true)).toMatchObject(
      {
        kind: "combo",
        shortcut: "alt+cmd+escape",
      },
    );
  });

  it("flags a key without a modifier", () => {
    expect(recordKey({ ...none, code: "KeyP" }, true)).toMatchObject({ bare: true });
  });
});

describe("shortcutKeys", () => {
  it("shows macOS symbols in ⌃ ⌥ ⇧ ⌘ order", () => {
    expect(shortcutKeys("cmd+alt+p")).toEqual(["⌥", "⌘", "P"]);
    expect(shortcutKeys("cmd+shift+ctrl+space")).toEqual(["⌃", "⇧", "⌘", "Space"]);
  });
});

describe("validateShortcut", () => {
  it("refuses a key without a modifier", () => {
    expect(validateShortcut("p", true, true)).toBe("Add at least one modifier: ⌘, ⌥, ⌃ or ⇧.");
  });

  it("refuses a macOS system shortcut, whatever the modifier order", () => {
    expect(validateShortcut("cmd+space", false, true)).toBe("⌘Space is used by macOS.");
    expect(validateShortcut("cmd+shift+4", false, true)).toBe("⇧⌘4 is used by macOS.");
    expect(validateShortcut("cmd+alt+escape", false, true)).toBe("⌥⌘⎋ is used by macOS.");
  });

  it("does not apply the macOS list elsewhere", () => {
    expect(validateShortcut("cmd+space", false, false)).toBeNull();
  });

  it("accepts an ordinary combination", () => {
    expect(validateShortcut("alt+cmd+k", false, true)).toBeNull();
  });
});
