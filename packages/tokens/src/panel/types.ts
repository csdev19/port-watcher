/*
 * Panel (menu-bar window) token names. Unlike the shadcn sets, these are the
 * FINAL custom-property names (without the leading `--`), because the desktop
 * renderer already references `--pw-*` everywhere and a few tokens
 * (`status-danger`, `radius-*`, `font-*`) deliberately keep their short names.
 */

/** Colours that change between the dark and the light appearance. */
export const PANEL_THEME_TOKEN_NAMES = [
  "pw-surface",
  "pw-band",
  "pw-band-soft",
  "pw-footer",
  "pw-raised",
  "pw-raised-hover",
  "pw-hover",
  "pw-border",
  "pw-border-strong",
  "pw-edge",
  "pw-line",
  "pw-line-row",
  "pw-veil",
  "pw-toast-bg",
  "pw-fg",
  "pw-fg-2",
  "pw-muted",
  "pw-muted-2",
  "pw-accent-soft",
  "pw-accent-ring",
  "pw-watched",
  "pw-free",
  "pw-plum",
  "pw-plum-hover",
  "status-danger",
] as const;

/** Identical in both appearances: brand colours, radii, type. */
export const PANEL_BASE_TOKEN_NAMES = [
  "pw-accent",
  "pw-accent-hover",
  "pw-action",
  "pw-action-hover",
  "pw-on-action",
  "radius-lg",
  "radius-md",
  "radius-sm",
  "font-sans",
  "font-mono",
] as const;

export type PanelThemeTokenName = (typeof PANEL_THEME_TOKEN_NAMES)[number];
export type PanelBaseTokenName = (typeof PANEL_BASE_TOKEN_NAMES)[number];

export type PanelThemeTokens = Record<PanelThemeTokenName, string>;
export type PanelBaseTokens = Record<PanelBaseTokenName, string>;
