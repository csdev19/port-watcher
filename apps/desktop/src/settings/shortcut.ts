/**
 * Shortcut recording helpers: browser KeyboardEvent -> the string form
 * tauri-plugin-global-shortcut parses ("alt+cmd+p"), plus the keycaps to
 * show for it and the checks that run before Rust is asked to register.
 */

export type ModifierFlags = {
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
};

/** The macOS symbols, in the order macOS writes them. */
const MOD_SYMBOLS = { ctrl: "⌃", alt: "⌥", shift: "⇧", cmd: "⌘" } as const;
const MOD_ORDER = ["ctrl", "alt", "shift", "cmd"] as const;
type Mod = (typeof MOD_ORDER)[number];

const KEY_LABELS: Record<string, string> = {
  space: "Space",
  enter: "↩",
  tab: "⇥",
  backspace: "⌫",
  delete: "⌦",
  escape: "⎋",
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  pageup: "⇞",
  pagedown: "⇟",
  home: "↖",
  end: "↘",
  minus: "-",
  equal: "=",
  comma: ",",
  period: ".",
  slash: "/",
  semicolon: ";",
  quote: "'",
  backquote: "`",
  backslash: "\\",
  bracketleft: "[",
  bracketright: "]",
};

export function isMac(): boolean {
  return typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);
}

/** Key names the plugin understands: "KeyP" -> "p", "Digit1" -> "1", the rest lowercased. */
function pluginKey(code: string): string {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1]!.toLowerCase();
  const digit = /^Digit([0-9])$/.exec(code);
  if (digit) return digit[1]!;
  return code.toLowerCase();
}

function keyLabel(key: string): string {
  return KEY_LABELS[key] ?? key.toUpperCase();
}

const LONE_MODIFIER = /^(Meta|Alt|Control|Shift|OS)(Left|Right)?$/;

export type Recorded =
  /** A lone modifier press: keep waiting for the real key. */
  | { kind: "ignore" }
  /** Esc with no modifier. */
  | { kind: "cancel" }
  | {
      kind: "combo";
      /** The plugin string, e.g. "alt+cmd+p". */
      shortcut: string;
      /** True when no modifier was held. */
      bare: boolean;
    };

/** Turns one keydown into a recording step. */
export function recordKey(
  event: ModifierFlags & { code: string },
  mac: boolean = isMac(),
): Recorded {
  if (LONE_MODIFIER.test(event.code)) return { kind: "ignore" };
  const mods: Mod[] = [];
  if (event.ctrlKey) mods.push("ctrl");
  if (event.altKey) mods.push("alt");
  if (event.shiftKey) mods.push("shift");
  if (event.metaKey) mods.push("cmd");
  if (event.code === "Escape" && mods.length === 0) return { kind: "cancel" };
  const names: string[] = mods.map((m) => (m === "cmd" && !mac ? "super" : m));
  return {
    kind: "combo",
    shortcut: [...names, pluginKey(event.code)].join("+"),
    bare: mods.length === 0,
  };
}

function parts(shortcut: string): { mods: Set<Mod>; key: string } {
  const mods = new Set<Mod>();
  let key = "";
  for (const token of shortcut.toLowerCase().split("+")) {
    if (token === "ctrl" || token === "control") mods.add("ctrl");
    else if (token === "alt" || token === "option") mods.add("alt");
    else if (token === "shift") mods.add("shift");
    else if (token === "cmd" || token === "command" || token === "super") mods.add("cmd");
    else key = token;
  }
  return { mods, key };
}

/** Keycaps for a plugin string: "alt+cmd+p" -> ["⌥", "⌘", "P"]. */
export function shortcutKeys(shortcut: string): string[] {
  const { mods, key } = parts(shortcut);
  return [...MOD_ORDER.filter((m) => mods.has(m)).map((m) => MOD_SYMBOLS[m]), keyLabel(key)];
}

/** The keycaps joined for a sentence: "⌥⌘P". */
export function shortcutText(shortcut: string): string {
  return shortcutKeys(shortcut).join("");
}

/**
 * Combinations macOS (or its default apps) already owns. A global shortcut
 * on one of these either fails or fights the system, so the recorder
 * refuses them up front. Written as normalised plugin strings: modifiers
 * in ctrl, alt, shift, cmd order, then the key. Not exhaustive: Rust still
 * reports a clash with any other app.
 */
export const MACOS_SYSTEM_SHORTCUTS: readonly string[] = [
  "cmd+space", // Spotlight
  "cmd+tab", // app switcher
  "cmd+backquote", // next window of the app
  "cmd+q", // quit
  "cmd+w", // close window
  "cmd+h", // hide app
  "cmd+m", // minimise window
  "shift+cmd+3", // screenshot: screen
  "shift+cmd+4", // screenshot: selection
  "shift+cmd+5", // screenshot and recording options
  "ctrl+space", // previous input source
  "alt+cmd+escape", // Force Quit
  "ctrl+cmd+q", // lock screen
  "ctrl+cmd+f", // full screen
  "ctrl+cmd+space", // emoji picker
  "shift+cmd+q", // log out
  "alt+cmd+d", // show or hide the Dock
];

function normalise(shortcut: string): string {
  const { mods, key } = parts(shortcut);
  return [...MOD_ORDER.filter((m) => mods.has(m)), key].join("+");
}

export function isMacOsSystemShortcut(shortcut: string): boolean {
  return MACOS_SYSTEM_SHORTCUTS.includes(normalise(shortcut));
}

/** The inline message for a refused combination, or null when it may be tried. */
export function validateShortcut(
  shortcut: string,
  bare: boolean,
  mac: boolean = isMac(),
): string | null {
  if (bare) return "Add at least one modifier: ⌘, ⌥, ⌃ or ⇧.";
  if (mac && isMacOsSystemShortcut(shortcut)) {
    return `${shortcutText(shortcut)} is used by macOS.`;
  }
  return null;
}
