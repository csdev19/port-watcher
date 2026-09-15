/*
 * Canonical token names. The generated CSS custom property for a token is
 * `--<prefix><name>` (the template ships the `mt-` prefix so tokens never
 * shadow shadcn's own `--background`/`--primary`/… variables). Names are
 * kebab-case string keys so the TS objects, the generated CSS, and every
 * `var(--…)` reference stay greppable as one identifier.
 */

/** Theme-invariant tokens: radius, typography. Emitted once under `:root`. */
export const BASE_TOKEN_NAMES = ["radius", "font-sans"] as const;

/**
 * Per-theme tokens: the shadcn semantic color set. Every theme must define all
 * of them — a missing token is a compile error (see `TokenSet`).
 */
export const THEME_TOKEN_NAMES = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "border",
  "input",
  "ring",
] as const;

export type BaseTokenName = (typeof BASE_TOKEN_NAMES)[number];
export type ThemeTokenName = (typeof THEME_TOKEN_NAMES)[number];

export type BaseTokens = Record<BaseTokenName, string>;

/** The full shape a theme must satisfy — a missing token is a compile error. */
export type TokenSet = Record<ThemeTokenName, string>;
