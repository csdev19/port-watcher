# ADR 0001 — A local-first Electron app in the template

- **Status:** accepted
- **Date:** 2026-09-03
- **Applies to:** `apps/desktop/`, `packages/tokens`, `scripts/customize.ts`

## Context

The template shipped five patterns, all of them web or service stacks, plus an
optional Expo app. Two packages — `packages/i18n` and `packages/tokens` — had no
consumer at all: `customize.ts` listed them in `UNUSED_PACKAGES` and deleted them
in every pattern. They were documented weeds.

Separately, the template's central claim — DDD + hexagonal, with a strict
dependency rule — was only ever demonstrated **once**. `ITodoRepository` had a
single adapter (`packages/infra-db`, Drizzle/Postgres), so a reader had to take
the "swap the adapter" argument on faith.

The starting point was an existing production Electron app,
[`kaipu-record`](https://github.com/csdev19/kaipu-record-monorepo), which had
already solved packaging, macOS signing and notarization, and the monorepo-specific
wiring for a workspace package inside an Electron main process.

## Decision

Add `apps/desktop`: a **local-first** Electron app with no server and no network
calls, whose main process implements `ITodoRepository` over on-device SQLite.

Specifically:

1. **Scaffold fresh on Electron 44**, rather than copying `kaipu-record`. About 88%
   of that app (29k of 33k lines) is its own product; its remaining skeleton is
   byte-identical to the output of `@quick-start/create-electron`. Four things were
   ported deliberately: the `electron-builder.yml` shape, the macOS entitlements,
   `scripts/build-mac-local.sh`, and the release workflow.
2. **The adapter lives in the app** (`src/main/infrastructure/`), not in a new
   `packages/infra-sqlite`. One consumer does not justify a package.
3. **`node:sqlite`** for storage: real SQL with no native module to rebuild per
   platform, which `better-sqlite3` would have required.
4. **CSS Modules over the unprefixed token sheet**, not Tailwind and not `web-ui`.
   The desktop and the web apps share a palette without sharing a component library.
5. **Workspace packages go in `devDependencies`.** `externalizeDepsPlugin`
   externalizes exactly what `dependencies` lists, and electron-builder packages
   exactly that; since these packages export raw TypeScript with no `dist`,
   externalizing them would make Node `require` a `.ts` file at runtime.
6. **Both an add-on and a pattern.** `--desktop` attaches the app to any pattern;
   `--pattern desktop-local-first` produces a repo containing nothing else.

## Alternatives rejected

- **Copy `kaipu-record` and strip it.** Would have meant deleting 29k lines to
  reach a skeleton the official scaffolder generates, and inheriting npm scripts,
  a mirror `.npmrc` and no catalog usage. It also pins Electron 39.
- **StyleX.** Genuinely attractive: `stylex.defineVars()` maps almost exactly onto
  `packages/tokens`. Rejected for a _template_ because there is no official Vite
  plugin (PostCSS or the community `@stylexswc/unplugin`), StyleX + electron-vite
  is undocumented by anyone, it is still 0.19 with breaking minors, and it would
  leave the monorepo with two styling systems. Its main win — atomic CSS, no
  runtime — barely pays in a renderer loading local files.
- **`packages/infra-sqlite` as a separate package.** Would have put two adapters of
  one port side by side in the directory tree, which reads well. Rejected as
  premature for a single consumer; extract it if a second one appears.
- **Electron shell around the existing web app.** Cheapest, but teaches nothing
  about Electron and would not justify `i18n` in a main process.
- **A minimal shell with no domain wiring.** Would have left `ITodoRepository` with
  one adapter, which is the gap this app exists to close.
- **`better-sqlite3` + Drizzle.** Closest parallel to `infra-db`, but a native
  module means `electron-builder install-app-deps` and per-platform CI rebuilds —
  the piece most likely to break in someone else's hands.

## Consequences

- `i18n` and `tokens` gain their first real consumer. `customize.ts` keeps them
  whenever the desktop app is kept (`survivingUnusedPackages`).
- `packages/tokens` now emits a second stylesheet, `css/tokens.desktop.css`,
  unprefixed. `generateCss(prefix)` already supported this; only the writer and the
  export map changed.
- `PatternConfig` gains `deploy`. `desktop-local-first` sets `"desktop-release"`,
  which suppresses the generated Cloudflare `deploy-production.yml` — the app ships
  from a `desktop-v*` tag instead.
- `ci-desktop.yml` and `release-desktop.yml` are **committed**, not generated, so
  `customize.ts` deletes them explicitly when the app is dropped.
- The app does not extend `packages/config`: its `tsconfig.base.json` sets
  `types: ["bun", "@cloudflare/workers-types"]`, which is wrong for an Electron
  process. It extends `@electron-toolkit/tsconfig` instead. This is a deliberate
  break in monorepo consistency.
- Windows and Linux are packaged but not released. `release-desktop.yml` carries a
  commented matrix job; their signing story is unvalidated.
- `node:sqlite` is experimental upstream. It needs no flag today, but a Node major
  in a future Electron release could change the API.

## Non-goals

- Authentication. The app is offline-first with no account; a later sign-in should
  be opt-in, using Better Auth's `bearer` plugin with the token in `safeStorage`.
- Sync, or any network call at all.
- Auto-update in a fresh clone. `electron-updater` is wired and the feed
  configuration is present, but publishing stays off until a bucket is configured.
- Shipping a signed build from the template itself. There are no certificates in a
  fresh clone, and the release workflow is expected to fail until they exist.

## What would reopen this

- **A second local-first consumer** (a CLI, a second desktop app, mobile going
  offline-first): extract `packages/infra-sqlite` as originally considered.
- **A decision to unify styling across web, desktop and mobile.** That is a
  monorepo-wide call and deserves its own ADR — StyleX would be the candidate to
  re-evaluate, and its Vite/electron-vite support is the thing to re-check.
- **`node:sqlite` changing shape** in a Node major, or graduating from experimental
  (which would remove the main caveat in `database.ts`).
- **The desktop app needing an account**, which turns the `LOCAL_USER_ID` constant
  into a real identity and pulls `infra-auth` back into this pattern.
