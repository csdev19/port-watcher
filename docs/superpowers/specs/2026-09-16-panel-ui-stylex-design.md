# panel-ui + StyleX — shared panel components and the end of style drift

Date: 2026-09-16 · Status: approved by owner (chat) · Owner: csdev19

## Context

The chapay panel design exists in three disconnected copies:

1. `apps/desktop/src/app.module.css` — the real design (`--pw-*` vars, glass
   surface, Geist), hand-inlined with a comment admitting no shared tokens
   package existed yet.
2. `packages/tokens/css/tokens.desktop.css` — misleadingly named; it is the
   shadcn web theme (oklch, Inter), with zero panel tokens.
3. `apps/fullstack-fn-only/src/routes/landing.css` — a third hand
   transcription for the marketing page's product shot.

Every desktop UI change silently outdates the landing's product shot (it
already shipped without the Favourites tab). The root cause is that no
shared component exists — not the choice of styling engine.

A key measurement unblocked the decision: `@port-watcher/web-ui` (shadcn +
Tailwind) is only consumed by 5 demo files (auth forms, user menu, todos).
The landing and the panel never touch it. So Tailwind/shadcn stay untouched
where they live, and StyleX becomes the engine of the new shared package —
they coexist; nothing gets rewritten.

## Decision

Create `@port-watcher/panel-ui`: presentational panel components styled
with **StyleX** (v0.17.x), fed by a completed `@port-watcher/tokens`, and
consumed by both the desktop app (live data) and the landing page
(fixtures). One source of markup and style; drift becomes impossible by
construction.

## Build & tooling

- Deps: `@stylexjs/stylex` (runtime, minimal) in `panel-ui`;
  `@stylexjs/postcss-plugin` + `postcss` as devDeps in each consuming app.
  All pinned in the root workspace catalog.
- **Integration path: the PostCSS plugin** (not `@stylexjs/unplugin`). One
  identical mechanism in both apps — plain Vite (desktop) and TanStack
  Start (fullstack) share Vite's PostCSS pipeline — and it coexists with
  Tailwind cleanly: in fullstack, `postcss.config` runs StyleX alongside
  Tailwind; shadcn's CSS and panel-ui's CSS are separate files.
- `panel-ui` ships **TS sources** (the `exports: "./src/index.ts"` pattern
  `tokens` already uses). Each app includes
  `../../packages/panel-ui/src/**/*.{ts,tsx}` in its PostCSS plugin
  `include`; CSS is generated inside the app's own build. No `dist/` to
  forget (avoids the web-ui gotcha).
- Tauri compatibility: StyleX compiles to static CSS at build time; the
  WKWebView receives plain CSS. Tauri is not involved in styling.

## Tokens: one source

- `packages/tokens` gains `src/themes/panel.ts`: the real panel palette —
  today's `--pw-*` values from `app.module.css`, verbatim, typed in TS.
- `panel-ui/src/tokens.stylex.ts` does `stylex.defineVars(panel)` (StyleX
  requires `defineVars` to live in a `.stylex.ts` file). It imports values
  from `@port-watcher/tokens`, so the tokens TS remains the single source;
  StyleX only materialises them as CSS vars.
- Components use `stylex.create()` referencing those vars. Nobody
  re-declares colours: `app.module.css` gets pruned; the panel leaves
  `landing.css` (the rest of the landing — hero, footer — stays plain CSS;
  it is not shared).
- `tokens.desktop.css` (actually the shadcn theme) is renamed or documented
  in the same pass so the name stops lying.

## The package

Cut rule: **panel-ui contains what appears in the landing's product shot**;
desktop-only interaction (kill-confirm arming, watch form, expanded detail,
edit-name) stays in desktop, consuming the same tokens.

File naming convention: **kebab-case** (`panel-tabs.tsx`, never
`PanelTabs.tsx`). Exported components stay PascalCase.

```
packages/panel-ui/src/
  tokens.stylex.ts     defineVars fed by @port-watcher/tokens
  types.ts             PortEntry, PortCategory (moved here; desktop re-exports)
  icon.tsx             Lucide wrapper, stroke 1.75 (moved from desktop)
  panel-chrome.tsx     the glass: surface/blur/radius/shadow/ring
  panel-search.tsx     search input (presentational)
  panel-tabs.tsx       Listening / Saved with counts
  port-row.tsx         full row: port, label, folder, uptime, save toggle, kill ✕
  panel-footer.tsx     "N ports · M dev · updated Xs ago" + gear
  fixtures.ts          demo data for the landing product shot
```

- `port-row.tsx` ships with the correct save-toggle treatment from day one:
  **bookmark icon** (not a star), fixed ink `#EDEDEF` when saved,
  muted-on-hover when unsaved, **cyan reserved for the focused row only**.

## Favourites → Saved (full rename)

Tab label, components (`saved-panel.tsx`), hooks (`use-saved-ports`), lib
(`saved.ts`), types, and storage. Storage key migrates
`chapay.favourites` → `chapay.saved`: on read, if the old key exists and
the new one does not, copy then delete the old — nothing saved is lost.
The inline edit-name feature keeps its behaviour, restyled with StyleX
during the desktop migration.

## Migration phases (each a green PR)

| Phase | What                                                                                                                                          | Risk              |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| 0     | SSR spike gate: trivial `stylex.create()` on the landing; `vite dev` + `vite build` + workerd preview. Go/no-go.                              | The only real one |
| 1     | `tokens/src/themes/panel.ts` + drift tests (TS values == current `--pw-*`)                                                                    | Low               |
| 2     | `panel-ui` with the 6 components + fixtures; consumed **by the landing first** (desktop untouched). Landing becomes faithful by construction. | Low               |
| 3     | Desktop migrates to the shared components; `app.module.css` pruned to non-shared styles. All 151 existing tests stay green.                   | Medium            |
| 4     | Saved rename (code+UI+storage+migration) + bookmark icon + star/cyan fix                                                                      | Low               |
| 5     | Cleanup: dead CSS, rename `tokens.desktop.css`, update CLAUDE.md and the general-knowledge case study if applicable                           | Low               |

Phases 2 and 3 deliberately invert the natural order: the landing proves
the package with fixed data before the real app is put at risk.

## Alternatives rejected

- **Share tokens only**: cheap, fixes colours, but the panel markup stays
  duplicated — the layout drift that motivated this keeps happening.
- **Real screenshot on the landing**: zero drift today, but every UI change
  requires recapture; not responsive or themeable.
- **Migrate everything (incl. shadcn) to StyleX**: unnecessary — shadcn is
  Tailwind-native and only 5 demo files use it. Coexistence is free.
- **`@stylexjs/unplugin` instead of PostCSS**: viable, but the PostCSS path
  is one mechanism for both apps and has better reported compatibility.

## Non-goals

- Touching `web-ui`/shadcn/Tailwind in the auth/todos demo.
- Theming (light panel) — the panel is dark by design; tokens make a future
  theme possible but none is built.
- Migrating desktop's non-shared styles (App layout, forms, detail) to
  StyleX beyond what Phase 3 requires — opportunistic follow-up.
- Renaming the repo/crate/workspace scope (`port-watcher`) — separate,
  deliberate change per CLAUDE.md.

## Reopening condition

If Phase 0 shows StyleX cannot produce correct CSS through TanStack Start's
SSR build on Cloudflare Workers (styles missing or duplicated in the workerd
preview), stop: fall back to the "shared package with plain CSS modules"
variant of this same architecture — the package structure and tokens work
survive unchanged; only the styling engine inside `panel-ui` changes.
