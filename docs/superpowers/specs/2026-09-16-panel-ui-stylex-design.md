# panel-ui + StyleX — shared panel components and the end of style drift

Date: 2026-09-16 · Status: approved for implementation planning · Owner: csdev19

The direction and review refinements are approved. This document describes
intended work, not implemented behavior.
Architecture rationale and integration dependencies are recorded in
[ADR 0002](../../adr/0002-shared-panel-ui-and-stylex.md).

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
(fixtures). One source of shared markup and style removes duplicate maintenance;
consumer CSS, fonts, fixture coverage, and integration still need verification.

## Build & tooling

- Deps: `@stylexjs/stylex` in `panel-ui`; `@stylexjs/babel-plugin`,
  `@stylexjs/postcss-plugin`, and `postcss` as devDeps in each consuming app.
  Pin compatible exact versions in the root workspace catalog after Phase 0
  verifies the intended 0.17.x release. Current online documentation alone is
  not evidence that an option exists in that pinned release.
- **Integration path: the PostCSS plugin** (not `@stylexjs/unplugin`). One
  identical mechanism in both apps — plain Vite (desktop) and TanStack
  Start (fullstack) share Vite's PostCSS pipeline — and it coexists with
  Tailwind: fullstack retains its existing `@tailwindcss/vite` integration;
  do not move Tailwind to PostCSS. Configure the StyleX Babel transform through
  the existing React/Vite integration as well as PostCSS extraction. PostCSS
  alone does not replace the JavaScript transform. Keep matching compiler and
  module-resolution options in both pipelines, verified by the spike.
- Each app imports one dedicated CSS entry containing exactly one `@stylex;`
  directive. Phase 0 must verify CSS ordering/layers against the existing
  reset, Tailwind styles, and CSS modules; separate files do not by themselves
  guarantee isolation. Preserve existing plugin ordering unless evidence from
  the spike requires a documented adjustment.
- `panel-ui` ships **TS sources** (the `exports: "./src/index.ts"` pattern
  `tokens` already uses). Each app includes
  `../../packages/panel-ui/src/**/*.{ts,tsx}` in its PostCSS plugin
  `include`, plus any app-local StyleX sources and token definition files;
  resolve scan paths independently of the shell working directory. The Babel
  transform must also process workspace sources in client and SSR builds.
  CSS is generated inside the app's own build. No `dist/` to forget (avoids
  the web-ui gotcha). Verify workspace edits trigger CSS updates in dev.
- Tauri compatibility: StyleX compiles to static CSS at build time; the
  WKWebView receives plain CSS. Tauri is not involved in styling.

## Tokens: one source

- `packages/tokens` gains `src/themes/panel.ts`: the real panel palette —
  today's `--pw-*` values from `app.module.css`, verbatim, typed in TS.
- Target: `panel-ui/src/tokens.stylex.ts` exposes named `defineVars` exports
  derived from `@port-watcher/tokens`. **`stylex.defineVars(panel)` with an
  imported plain TS object is an unverified compiler assumption**, not an
  implementation instruction. Phase 0 must compile that exact workspace
  import path using the pinned release. If unsupported, stop for review of
  a deterministic generated-literal adapter or the CSS-module fallback;
  do not hand-copy a second editable palette or silently change token ownership.
- Non-shared desktop CSS must retain access to the same token values. Phase 1
  must specify the bridge (stable custom-property names if supported, or a
  deterministic generated CSS adapter), its owning file and scope, and the
  freshness check. Pruning old declarations must not break remaining `--pw-*`
  consumers. Generation, if needed, must run in fresh-clone dev/build workflows.
- Components use `stylex.create()` referencing those vars. Nobody
  re-declares colours: `app.module.css` gets pruned; the panel leaves
  `landing.css` (the rest of the landing — hero, footer — stays plain CSS;
  it is not shared).
- `tokens.desktop.css` (actually the shadcn theme) is renamed or documented
  in Phase 5 after its exports and consumers have been inventoried.

## The package

Cut rule: **panel-ui contains what appears in the landing's product shot**;
desktop-only interaction (kill-confirm arming, watch form, expanded detail,
edit-name) stays in desktop, consuming the same tokens.

File naming convention: **kebab-case** (`panel-tabs.tsx`, never
`PanelTabs.tsx`). Exported components stay PascalCase.

```
packages/panel-ui/src/
  tokens.stylex.ts     defineVars fed by @port-watcher/tokens
  types.ts             presentation contracts; type ownership resolved before Phase 2
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

### Component ownership and contract gate

Before Phase 2, the implementation plan must enumerate typed props, callbacks,
DOM/ref requirements, accessible names, and supported states for each component.
Use existing desktop behavior as the source of truth, including keyboard
navigation and nested action propagation; do not redesign it during extraction.

- Shared components own rendering and styles, not Tauri calls, storage, query
  hooks, timers, kill policy, confirmation state, or routing.
- Desktop owns search/tab/focus state, derived row data, save mutations,
  confirmation arming/expiry, pending/error state, and expanded detail. Shared
  controls emit intent; rendering a kill button must never bypass confirmation.
- Chrome accepts composed content. Search and tabs are controlled. Rows expose
  the states needed by existing interactions rather than recreating controllers.
  Footer accepts caller-derived status so Saved query-health messages survive.
- Loading, empty, stale, unavailable, disabled, armed, and pending states must
  be assigned to a component or app wrapper explicitly. Preserve focus-visible
  treatment and accessible button/input semantics.
- Landing uses deterministic fixtures and no native/storage dependencies.
  Define the product shot as a static preview: no working kill/save actions or
  misleading enabled controls. Document its accessibility treatment and test
  that preview styling still matches the shared live component.
- Do not move the native IPC `PortEntry` contract into a presentation package
  by default. Before extraction, map its consumers and choose a minimal
  presentation input or a justified shared contract location. Record any
  ownership change in the ADR; desktop data/IPC helpers must not gain runtime
  dependencies on React or StyleX merely to import a type.

## Favourites → Saved (full rename)

Tab label, components (`saved-panel.tsx`), hooks (`use-saved-ports`), lib
(`saved.ts`), types, and storage change in Phase 4. Until then the controlled
shared tab accepts the existing desktop label; landing may show the final
Saved copy. Bookmark styling lands with the shared row in Phase 2 and reaches
desktop in Phase 3, not again in Phase 4. Inline edit-name keeps its behavior
and existing styling mechanism; only token wiring and necessary composition
changes belong to this migration.

Storage migrates `chapay.favourites` → `chapay.saved` with these rules:

- If the new key exists, it is authoritative, including an empty array. Never
  merge or overwrite it from the old key, even if the new JSON is invalid.
- If only the old key exists, parse and validate using the existing sanitizer.
  For a fully valid array, write the new key before deleting the old key.
- Malformed JSON is retained and surfaces the existing load-error behavior.
  For partially recoverable records, show sanitized items with a recovery
  notice but do not automatically write/delete either key during migration.
- If writing fails, keep the old key, keep recoverable items available, and
  surface a persistence error. Subsequent user mutations still persist before
  updating UI state. A later initialization can retry the migration.
- If deleting fails after a successful write, the new key remains authoritative;
  retain both keys and report a non-blocking cleanup error. Do not fall back to
  stale old data or silently merge it on a later launch.
- If reading storage throws, do not attempt migration writes. Missing both keys
  means an empty list without an error.
- Migration must be safe under repeated initialization, including React Strict
  Mode. Explicit successful mutations may save recovered data to the new key;
  retained legacy data is not automatically deleted in that recovery path.
  Tests cover every branch above, names/order preservation, and repeat reads.

## Migration phases (each a green PR)

| Phase | What                                                                                                                                          | Risk   |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 0     | Full-path compiler/SSR spike in both apps, including workspace tokens, CSS extraction, HMR, and workerd preview. Go/no-go.                    | High   |
| 1     | `tokens/src/themes/panel.ts` + drift tests (TS values == current `--pw-*`)                                                                    | Low    |
| 2     | `panel-ui` with the 6 components + fixtures; consumed **by the landing first** (desktop untouched). Landing becomes faithful by construction. | Low    |
| 3     | Desktop adopts shared components and bookmark styling; CSS pruned only after remaining token consumers are covered; behavior preserved.       | Medium |
| 4     | Saved rename (code + UI + storage) with failure-safe migration and recovery tests.                                                            | Medium |
| 5     | Cleanup: dead CSS, rename `tokens.desktop.css`, update CLAUDE.md and the general-knowledge case study if applicable                           | Low    |

Phases 2 and 3 deliberately invert the natural order: the landing proves
the package with fixed data before the real app is put at risk.

### Phase 0 evidence required before implementation planning is finalized

Exercise a minimal shared-package component using a token from the actual
workspace import path in both apps. Record exact versions, config, commands,
and observed results for:

1. Desktop and fullstack dev rendering plus HMR after a shared component and
   token edit (including any generation step).
2. Production builds for both renderers, and fullstack workerd preview of the
   built output. Confirm actual computed styles, not just successful compilation.
3. SSR HTML and hydration agree on classes; CSS and token definitions are loaded
   without missing rules or duplicate StyleX entry injection. Test a direct page
   load and client navigation to the landing.
4. Existing Tailwind/shadcn demo styles and desktop CSS-module styles survive;
   glass, fonts, focus treatment, and cascade ordering remain correct.
5. The existing desktop test runner can import shared StyleX components with
   the required transformation. Do not replace meaningful behavior assertions
   with mocks of the entire shared package merely to get green tests.

Any unresolved compiler, token bridge, or SSR failure blocks later phases.
Do not diagnose integration failure as intrinsic StyleX incompatibility until
the complete transform/extraction pipeline has been checked.

### Execution-document requirements

Write an index plus small dependency-ordered task documents under
`docs/superpowers/plans/panel-ui-stylex/`. Each task must name
prerequisite documents/commits, exact file scope, concrete contracts, ordered
edits, verification commands with expected results, stop conditions, and a
handoff checklist. Split component extraction, desktop integration, and storage
migration into independently verifiable units; do not assign an entire phase
to an agent when it still contains unresolved design choices.

Record the current test baseline before implementation; the original count of
151 is historical context, not an acceptance criterion. Require the relevant
existing behavior tests, new migration/integration coverage, type checks, and
consumer builds to pass. Include manual desktop checks for keyboard/pointer
confirmation, edit-name, query-health states, and persistence after restart,
plus landing visual checks at supported widths. Token drift checks must use
a durable baseline rather than CSS declarations scheduled for deletion.

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
  StyleX, including the edit-name form; only necessary token/composition wiring
  is in scope.
- Renaming the repo/crate/workspace scope (`port-watcher`) — separate,
  deliberate change per CLAUDE.md.

## Reopening condition

If Phase 0 shows StyleX cannot produce correct CSS through TanStack Start's
SSR build on Cloudflare Workers (styles missing or duplicated in the workerd
preview), stop: fall back to the "shared package with plain CSS modules"
variant of this same architecture — the package structure and tokens work
survive unchanged; only the styling engine inside `panel-ui` changes.
