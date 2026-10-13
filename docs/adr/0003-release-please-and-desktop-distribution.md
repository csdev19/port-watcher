# ADR 0003: release-please versioning and desktop distribution through R2

**Status:** accepted and in use; amended by [ADR 0004](0004-public-hostnames-and-release-variables.md)
(public hostnames, `R2_BUCKET`/`DOWNLOAD_BASE_URL` as variables, secrets shipped
with the deploy) and [ADR 0005](0005-disable-web-auth-and-database.md) (the web Worker ships no
secrets while auth and the database are off). The first run on `main` (2026-10-05) failed for lack
of `RELEASE_PLEASE_TOKEN`; release-please has since produced the tags `desktop-v0.1.0` and
`web-v0.1.0` (2026-10-12).
**Date:** 2026-09-21.

## Context

`apps/desktop` had no release pipeline: the only way to get chapay was to build
it locally. The web app's `deploy-production.yml` triggered on pushes to a
`production` branch that does not exist, so it never ran. Neither app's version
was a committed fact tied to what shipped.

The reusable pattern — tag-driven releases, release-please creating the tags,
desktop installers on Cloudflare R2 — is documented in the hub:
[ci-cd-pipelines](https://github.com/csdev19/general-knowledge/blob/main/monorepos/ci-cd-pipelines.md),
[release-automation](https://github.com/csdev19/general-knowledge/blob/main/monorepos/release-automation.md)
and the
[release-please playbook](https://github.com/csdev19/general-knowledge/blob/main/monorepos/release-please-playbook.md).
This ADR records how chapay applies it. The hub's reference implementation is
Electron; chapay is Tauri.

## Decision

- **release-please, topology B (independent lines).** Components `desktop`
  (`apps/desktop`, tags `desktop-v*`) and `web` (`apps/fullstack-fn-only`, tags
  `web-v*`). Their closures are disjoint today — desktop imports only
  `@port-watcher/config`, a lint/tsconfig package with no runtime code. Desktop
  is also a consumer users update on their own schedule, which gives it its own
  line regardless.
- Both manifests were seeded at `0.0.0` and the first release was meant to be `0.1.0`.
  Without a previous tag release-please defaulted the first release to `1.0.0`, so
  `release-please-config.json` now sets `"initial-version": "0.1.0"` on both components and the
  manifest records `0.1.0` for both. `bump-minor-pre-major` keeps breaking changes on a minor bump
  pre-1.0.
- **The desktop version has one source.** `tauri.conf.json` sets
  `"version": "../package.json"`, so the version release-please bumps is the
  one Tauri stamps into the bundle and the DMG name.
- **`release-desktop.yml`** on `desktop-v*`: builds `aarch64` and `x86_64`
  DMGs separately (not universal, to keep each download at half the size),
  signs with the Developer ID certificate imported into a throwaway keychain,
  notarizes through Tauri with the App Store Connect API key, uploads to
  `chapay-bucket` (originally `port-watcher-bucket`) under `download/<version>/` and `download/latest/`,
  keeps the last 3 versions, and attaches the DMGs to a draft GitHub Release.
  _Amended (NIW2-345): release-please owns the GitHub Release; the workflow
  only uploads the DMGs and `SHA256SUMS` to it, and builds before importing
  the signing certificate._
  Secret names match the other desktop repos so the same values can be reused.
- **`release-web.yml`** (renamed from `deploy-production.yml`) runs on `web-v*`
  instead of the `production` branch. The deploy steps are unchanged.

## Alternatives rejected

- **Universal binary.** One file, but twice the size for every user.
- **Unsigned builds for now.** Faster to set up, but Gatekeeper blocks a
  downloaded unsigned app outright on current macOS; the certificate already
  exists.
- **Letting Tauri import the certificate (`APPLE_CERTIFICATE`).** Works, but
  resolving the identity ourselves fails loudly and early if the `.p12` is not
  a Developer ID Application certificate.
- **Single version line.** Would release desktop for web-only changes, pushing
  pointless updates to users.

## Consequences

- Owner setup before the first real run (the `production` environment):
  `RELEASE_PLEASE_TOKEN`, the five signing secrets, `R2_ACCESS_KEY_ID`,
  `R2_SECRET_ACCESS_KEY`, and `CLOUDFLARE_ACCOUNT_ID`; create the
  `chapay-bucket` R2 bucket and, for public downloads, a custom domain
  or `r2.dev` URL on it.
- Commits touching only `packages/*` route to no component. They reach the web
  release only when a later `feat`/`fix` under `apps/fullstack-fn-only` ships,
  or through a `Release-As` commit.
- The web deploy now runs only when a release PR is merged or on manual
  dispatch, never on a push.

## Non-goals

- In-app auto-update. `tauri-plugin-updater` is not installed, so no update
  feed (`updates/`) is published — users download new DMGs by hand.
  _(Amended by [ADR 0007](0007-desktop-updates-through-tauri-updater.md) on branch
  `feat/auto-updater`: from 0.2.0, `release-desktop.yml` publishes signed update archives and
  `updates/latest.json`, and chapay installs updates after a click.)_
- Windows and Linux builds.
- A download page on the landing site. _(Superseded in practice: the landing now has a download
  button for the arm64 and x64 DMGs, ADR 0004. A dedicated multi-page download site remains out of
  scope.)_

## Reopen when

- Desktop starts importing a runtime workspace package that web also uses
  (e.g. `@port-watcher/panel-ui` from ADR 0002) — the closures then intersect
  and need either one line or a written compatibility contract.
- The updater plugin is added: publish its feed and signatures from this
  workflow. _(Met: ADR 0007.)_
- A second desktop platform ships.
