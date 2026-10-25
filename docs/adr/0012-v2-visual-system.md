# ADR 0012: the v2 visual system — solid "chicha" sheet, light theme, chapay wordmark

**Status:** Accepted by the owner (2026-10-24). Implemented by Phases 1 and 4 on `feat/chapay-v2`; on
`main` once that branch merges.
Amends [ADR 0002](0002-shared-panel-ui-and-stylex.md) where it lists a light theme as a non-goal.
**Date:** 2026-10-24.
**Source of truth for visuals:** the "Chapaq Panel v2" canvas in Claude Design (sections 7a, 7b, 8a,
9a, 10a, 10b), adapted by the [v2 spec](../specs/2026-10-24-chapay-v2-design.md).

## Context

The owner produced a v2 design in Claude Design. It changes the panel's palette, adds a header with
the door mark and a live pill, a Settings / Quit footer, a light theme that follows the system, and the
Machine tab. The canvas spells the brand "chapaq"; the owner decided the product name stays
**chapay** everywhere (domain `chapay.cs19.dev`, app, DMGs).

## Decision

- Adopt the v2 palette: solid sheet `#141018` (dark) with bands `#1A1522`; cyan `#0FC2D7` = the row you
  are on; fuchsia `#FF1E8C` = the one main action and the wordmark dot; mint = free; yellow = watched /
  warn; red `#FF5C62` = kill and stop. Colour is a dot, a bar, a glyph or one button, never a fill.
- **Light theme** follows the macOS appearance, with an override in Settings; on white, mint drops to
  `#0BAE7B` and yellow to amber `#FFB020`.
- Wordmark **`chapay.`** with the fuchsia dot. Every visible "chapaq" in the repo (landing, docs, UI)
  becomes "chapay". `productName`, DMG names, R2 paths, bundle id and the `chapay.favourites` key do
  not change.
- Geist and Geist Mono are bundled locally (no network font fallback in a signed app).
- Panel tokens live in `@port-watcher/tokens` as a generated panel token set, consumed by the desktop
  renderer.

## Alternatives rejected

- **Rename to chapaq.** Breaks the domain, the DMG names the release workflow and landing depend on,
  and splits the brand further. Owner decision.
- **Dark only.** The design and the owner want the system appearance followed.

## Consequences

- Visual changes touch most renderer components; behaviour and hooks stay.
- The light theme must pass contrast (amber text on white needs a darker step).

## Non-goals

A new tray glyph (the door already exists); a new app icon; glass/vibrancy (retired in v1).

## Reopen when

- The owner renames the product, or
- the light theme cannot follow live appearance changes inside the menu-bar window.
