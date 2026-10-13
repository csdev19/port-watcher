# ADR 0004: public hostnames and release variables

**Status:** accepted; configuration is on `main` and in use: release-please has produced
`desktop-v0.1.0` and `web-v0.1.0` (2026-10-12). The auth-related parts of the Decision and
Consequences below are superseded by the 2026-10-12 amendment and
[ADR 0005](0005-disable-web-auth-and-database.md); they are annotated in place.
**Date:** 2026-10-06.

**Amendment (2026-10-12):** the R2 bucket is `chapay-bucket`, not
`port-watcher-bucket`. Auth (better-auth) and the database are disabled in the
web app until it needs accounts: the landing is the only route, so
`DATABASE_URL`, `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` are no longer part
of the owner setup below, and the deploy ships no Worker secrets. The code is
unregistered and commented out, not deleted; `packages/infra-auth` and
`packages/infra-db` are unchanged.

**Amendment (2026-10-12, hostname):** the web app is served on
`chapay.cs19.dev`, not `port-watcher.cs19.dev`, matching the owner's other apps
(`pichay.cs19.dev`, `rikchay.cs19.dev`), which use the product name rather than
the repository name. Nothing had been deployed on the old hostname.

## Context

ADR 0003 put the release pipeline in place but left two things open: where the
web app is reachable, and which public URL the landing's download button points
at. The web Worker had no `routes`, so it would only answer on `workers.dev`;
the landing linked to the GitHub Releases page with a `TODO` naming a
`chapay-updates.cs19.dev` host that nobody had created; and the bucket name was
a constant inside one workflow, invisible to the other.

Meanwhile the first run of `release-please.yml` on `main` failed for lack of a
token, and the `production` environment had no secrets or variables at all:
nothing had ever shipped.

my-pets (the owner's other macOS app, same Cloudflare account, same `cs19.dev`
zone) solved the same problem days earlier with a documented runbook: the site
on a Worker custom domain `mypets.cs19.dev`, installers on a public R2 bucket,
and the two non-sensitive values (`R2_BUCKET`, `DOWNLOAD_BASE_URL`) as GitHub
environment **variables** rather than secrets or constants. chapay adopts that
layout so the same account, token scopes and mental model serve both apps.

## Decision

- **Web:** the Worker declares `chapay.cs19.dev` as a custom domain in
  `apps/fullstack-fn-only/wrangler.jsonc` (`custom_domain: true`). Wrangler
  creates the DNS record on deploy; the zone must be in the same Cloudflare
  account and the deploy token needs Zone DNS: Edit on it. `BETTER_AUTH_URL`
  is that origin _(only when auth is enabled; it is not read today, ADR 0005)_.
- **Installers:** the bucket is **public** and its public URL is the
  `DOWNLOAD_BASE_URL` variable, no trailing slash. Today that is the bucket's
  `pub-<id>.r2.dev` URL, exactly as my-pets; a custom domain later is only a
  variable change plus one R2 setting, no code. Object layout stays as ADR
  0003: `download/<version>/chapay-{arm64,x64}.dmg` (immutable, cached one
  year) and `download/latest/chapay-{arm64,x64}.dmg` (revalidated on every
  request).
- **Variables, not secrets, for non-sensitive values.** `R2_BUCKET` and
  `DOWNLOAD_BASE_URL` are `vars.` in the `production` environment, readable in
  the Actions UI. Both release workflows read the same `DOWNLOAD_BASE_URL`: the
  desktop one verifies the published URLs answer, the web one bakes it into the
  landing as `VITE_PUBLIC_DOWNLOAD_URL`. One value, so the button and the
  bucket cannot disagree.
- **The landing falls back to GitHub Releases** when the variable is absent
  (PR validation builds, local dev), so a missing value degrades to the old
  behaviour instead of a dead link.
- **Worker secrets ship with the deploy** (`wrangler deploy --secrets-file`),
  replacing the action's `secrets:` input, and wrangler is pinned in the
  workflow. Both are hub rules
  ([worker-secrets-with-deploy](https://github.com/csdev19/general-knowledge/blob/main/monorepos/worker-secrets-with-deploy.md),
  [wrangler-env-config](https://github.com/csdev19/general-knowledge/blob/main/monorepos/wrangler-env-config.md));
  this ADR only records that chapay now follows them. _(Today the Worker has no
  secrets, so the deploy runs without `--secrets-file`; the mechanism returns
  with auth, ADR 0005.)_
- **`bootstrap-sha`** is set to the `main` commit at adoption so the first
  release PR's changelog starts there instead of walking the whole history.
  The desktop manifest stays at `0.0.0`, so the first desktop tag is
  `desktop-v0.1.0`, matching the version already in `apps/desktop/package.json`.
  _(Update: `"initial-version": "0.1.0"` was later added to `release-please-config.json` because
  release-please otherwise proposed `1.0.0` for the first release; both manifests now say
  `0.1.0`.)_

## Alternatives rejected

- **Serving the DMGs through the web Worker** (`chapay.cs19.dev/download/…`
  with an R2 binding). One hostname, but tens of megabytes per download would
  stream through the Worker, and a web release would then depend on a desktop
  release.
- **An R2 custom domain (`chapay-updates.cs19.dev`) from day one.** Nicer URL
  and Cloudflare cache in front, but one more hostname to create before
  anything ships, and the name promises an update feed that ADR 0003 declares
  a non-goal. Deferred, not rejected: it is a variable change.
- **Keeping GitHub Releases as the download target.** Zero infrastructure, but
  the release stays a draft until a human publishes it, and it contradicts the
  reason ADR 0003 exists.
- **Bucket name as a secret or a workflow constant.** A secret hides a value
  that is not sensitive; a constant lets the two workflows drift.

## Consequences

- Owner setup before the first real run, all in the `production` environment
  (names identical to my-pets so values can be copied):
  - secrets `RELEASE_PLEASE_TOKEN`, `CSC_LINK`, `CSC_KEY_PASSWORD`,
    `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`,
    `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `CLOUDFLARE_ACCOUNT_ID`,
    `CLOUDFLARE_API_TOKEN`, and, only once auth is enabled again (ADR 0005),
    `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`;
  - variables `R2_BUCKET`, `DOWNLOAD_BASE_URL`;
  - the bucket itself with public access enabled. No DNS record is needed
    for the web hostname: wrangler creates it, and the zone's `*.cs19.dev`
    wildcard does not block a custom domain.
- `r2.dev` URLs are rate-limited by Cloudflare and documented as
  development-grade. Acceptable at chapay's scale; see "Reopen when".
- Changing `DOWNLOAD_BASE_URL` requires a web release to update the landing.

## Non-goals

- In-app auto-update and an update feed (ADR 0003). _(Amended by ADR 0007.)_
- A `www.` alias or an apex domain for the web app.
- Windows and Linux installers.

## Reopen when

- Downloads hit `r2.dev` rate limits or need Cloudflare caching: add an R2
  custom domain and change the variable.
- The updater plugin lands: the feed's host is `DOWNLOAD_BASE_URL` and becomes
  permanent for installed copies, so decide the final hostname first.
  _(Met and decided in [ADR 0007](0007-desktop-updates-through-tauri-updater.md): the owner kept
  the `r2.dev` URL as the feed host. Moving to a custom domain later now needs a bridge release,
  not only a variable change.)_
