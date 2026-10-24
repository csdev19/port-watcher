import type { PanelThemeTokens } from "./types";

/**
 * Panel light appearance (design 7b). Cyan, fuchsia and the door stay as in
 * dark (see `panelBase`); mint, yellow and danger darken to keep contrast on white.
 */
export const panelLight: PanelThemeTokens = {
  "pw-surface": "#ffffff",
  "pw-band": "#f5f5f7",
  "pw-band-soft": "#fafafb",
  "pw-footer": "#f5f5f7",
  "pw-raised": "#f5f5f7",
  "pw-raised-hover": "#ebebf0",
  "pw-hover": "#f2f2f2",
  "pw-border": "#e5e5e5",
  "pw-border-strong": "#d2d2d7",
  "pw-edge": "rgba(17, 17, 17, 0.08)",
  "pw-line": "#e5e5e5",
  "pw-line-row": "#eeeef0",
  "pw-veil": "rgba(255, 255, 255, 0.92)",
  "pw-toast-bg": "#1c1822",
  "pw-fg": "#111111",
  "pw-fg-2": "#3a3a3c",
  "pw-muted": "#6e6e73",
  "pw-muted-2": "#8e8e93",
  "pw-accent-soft": "rgba(15, 194, 215, 0.12)",
  "pw-accent-ring": "rgba(15, 194, 215, 0.28)",
  "pw-watched": "#ffb020",
  "pw-free": "#0bae7b",
  "pw-plum": "#ececf0",
  "pw-plum-hover": "#e2e2e8",
  "status-danger": "#e5484d",
};
