# Desktop template readiness review

- **Date:** 2026-09-03
- **Scope:** `apps/desktop` and its template, customization, CI, and release wiring.
- **Out of scope:** the Todo CRUD screen and its data-flow behavior. It is an intentional placeholder.

## Outcome

The desktop app is ready to clone and use for local development: its dependency
graph, Electron/Vite configuration, IPC boundary, assets, type-checking, tests,
and desktop-specific CI are present. The desktop-only customization pattern is
also covered by structural and build CI.

Production distribution is intentionally a starting point, not turnkey. A new
project owner must set its own identity and signing/release credentials before
shipping. The following items record the remaining gaps so they are deliberate,
rather than implicit template behavior.

## Readiness matrix

| Area                        | Status                             | Notes                                                                                                                        |
| --------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Clone and local development | Ready                              | Bun workspace, `dev:desktop`, tests, type-checking, and Vite build are wired.                                                |
| Local storage and settings  | Ready                              | Data is scoped to Electron `userData`; no server or runtime environment is required.                                         |
| Desktop-only customization  | Ready with follow-up configuration | The customizer retains the desktop app and the packages it consumes, but does not yet derive desktop identity from `--name`. |
| macOS packaging and signing | Configured                         | The workflow and local signing script expect an owner-provided Developer ID and Apple notarization credentials.              |
| Auto-update                 | Not implemented                    | Feed configuration exists, but the app does not invoke `electron-updater`.                                                   |
| Windows and Linux releases  | Not implemented                    | Packaging targets are declared; release and signing automation is intentionally not enabled.                                 |

## Required owner configuration before distribution

The desktop configuration intentionally carries safe placeholders. Before a
project is distributed, its owner must replace all of the following consistently:

- `APP_ID` in `apps/desktop/src/main/index.ts` and `appId` in
  `apps/desktop/electron-builder.yml`. Keep these aligned as the application's
  Windows/packaging identity.
- `productName`, `win.executableName`, and `linux.maintainer` in
  `apps/desktop/electron-builder.yml`.
- The desktop package name and the HTML title.
- The artifact names and download paths hard-coded in `release-desktop.yml`, if
  the product/executable name changes.
- The generic update-feed URL in `apps/desktop/electron-builder.yml` and
  `apps/desktop/dev-app-update.yml`, if auto-update will be added.
- The updater cache name in `dev-app-update.yml`, if auto-update will be added.
- macOS signing and notarization secrets described in
  `apps/desktop/.env.signing.example` and the release workflow.

This is important because the template's generic package/product identity can
make derived applications indistinguishable in local application data and
packaging. `APP_ID` is specifically the Windows AppUserModelID/taskbar identity;
it does not itself set Electron's `userData` path. Two customized projects that
retain the generic identity can still collide or look indistinguishable on a
developer or user's machine.

## Follow-up work

### 1. Derive desktop identity during customization

**Priority: high.** `scripts/customize.ts --name` renames workspace scopes but
leaves the desktop application identity, release artifact names, and update
placeholders unchanged. The customizer should either request the relevant
identity values and write them consistently, or stop with an explicit first-run
configuration step. This prevents accidental collisions between projects created
from the template.

### 2. Validate release tag and package version

**Priority: high.** The release workflow accepts tags matching `desktop-v*.*.*`
but names artifacts from `apps/desktop/package.json`. It should fail before the
build when the tag version does not equal `package.json.version`; otherwise a
`desktop-v0.2.0` release can contain `0.1.0` artifacts and update metadata.

### 3. Either implement auto-update or remove its scaffolding

**Priority: medium.** The release workflow can publish `latest-mac.yml` and ZIP
assets and the app declares `electron-updater`, but no main-process code imports
or calls `autoUpdater`. Publishing an update bucket therefore does not update
any installed client. Add an explicit updater lifecycle and user experience, or
remove the dependency/feed configuration until that work is planned.

### 4. State platform support accurately

**Priority: medium.** macOS has a signing/release path. Windows and Linux only
have electron-builder targets; their CI/release matrix is commented out pending
signing validation. Treat those platforms as packaging-ready, not release-ready.

### 5. Polish desktop-only customizer output

**Priority: low.** The generated desktop-only README still gives a generic
instruction to copy an `.env.example`, although this app needs no runtime env.
The customizer also leaves `scripts/customize.test.ts`, which references paths it
has removed, and some general context text can retain web/database references.
These do not block development, but cleaning them would make the resulting
project more self-explanatory.

## Verification recorded during review

- Desktop type-checking, unit/component tests, and the Electron/Vite build
  completed successfully during review.
- The customizer's structural test suite passed, including the desktop-only
  pattern.
- An unpacked `electron-builder` packaging check reached packaging configuration,
  but could not download a GitHub-hosted artifact in the review environment due
  to DNS restrictions. This was not treated as a template failure.
