# ADR 0007: desktop updates through tauri-plugin-updater and a static feed on R2

**Status:** Accepted (2026-10-13). Implemented on branch `feat/auto-updater`, which builds on
`feat/settings` (PR #45); neither is on `main` yet. No release has run the new workflow steps, and
the updater public key is still a placeholder in `tauri.conf.json` until the owner commits the
real one. Planned to ship in the same release as Settings (`0.2.0`). This ADR amends the "In-app
auto-update" non-goal of [ADR 0003](0003-release-please-and-desktop-distribution.md) and meets the
updater reopen conditions of ADR 0003 and [ADR 0004](0004-public-hostnames-and-release-variables.md).
**Date:** 2026-10-13.
**Spec:** [docs/specs/2026-10-13-desktop-auto-updater.md](../specs/2026-10-13-desktop-auto-updater.md).

## Context

chapay ships as signed, notarized DMGs on Cloudflare R2, built by `release-desktop.yml` on
`desktop-v*` tags that release-please creates (ADR 0003, ADR 0004). An update today is a manual
download and drag. The installed base is `0.1.0`, which contains no update code. PR #45 adds a
"Check for updates" button that asks the GitHub API and opens the release page.

chapay is a menu-bar (Accessory) app with no Dock icon. It holds Full Disk Access, which macOS
ties to the app's designated requirement. The shipped requirement pins the bundle id
`dev.csdev19.portwatcher` and Team ID `K9TKC5GG76`. The repository's GitHub "Latest" release is
`web-v0.1.0`, so `releases/latest/…` URLs cannot serve the desktop line.

## Decision

- **Updater:** `tauri-plugin-updater` 2.13.3 (≥ 2.13.2 for the safe macOS install), driven from
  Rust (`src-tauri/src/update/`) through four app commands (`update_status`, `update_check`,
  `update_install`, `update_restart`) and one event (`update-status`). The webview gets no
  `updater:*` permission. Rust holds the state, so the panel and Settings show the same thing.
- **Feed host: the existing R2 public URL.** The feed is `$DOWNLOAD_BASE_URL/updates/latest.json`,
  where `DOWNLOAD_BASE_URL` is the `production` environment variable (today a `pub-….r2.dev`
  URL). No custom domain. Cloudflare rate-limits `r2.dev` URLs and documents them as not meant
  for production; at chapay's scale (one small JSON request per copy per day) that is accepted.
  The URL is baked into every installed copy, so moving the feed later needs a **bridge
  release** (see "Reopen when").
- **Endpoint injected at release build time.** The committed `tauri.conf.json` has
  `endpoints: []`. The release workflow passes the endpoint with
  `tauri build --config '{"plugins":{"updater":{"endpoints":[…]}}}'` from `DOWNLOAD_BASE_URL`.
  Local and dev builds therefore have no endpoint: they report "Updates are off in this build"
  and never contact the feed.
- **Public key committed**, under `plugins.updater.pubkey` in `tauri.conf.json` (a placeholder
  until the owner generates the key). The workflow refuses to build while it is the placeholder
  and verifies every `.sig` against it with minisign.
- **Feed contents:** `darwin-aarch64` and `darwin-x86_64` entries pointing at immutable
  `download/<version>/chapay-<arch>.app.tar.gz` objects. The workflow writes the feed with
  `apps/desktop/scripts/updater-feed.sh` (`jq`) and publishes it **last**, after every file it
  points at answers publicly. It refuses to move the feed to an older version; the same version
  is republished, so a rerun of a tag keeps the feed's signatures in step with the re-signed
  archives. `tauri-action` is not adopted.
- **Integrity:** `requireSignedVersion: true` from the first release (CLI ≥ 2.12.0; the repo
  pins `^2.12.2`). A custom comparator accepts only a strictly newer plain `X.Y.Z`, so the
  plugin's `allowDowngrades` cannot take effect. Archive URLs must be HTTPS. Before installing,
  the app unpacks the verified archive and requires `codesign --verify --strict --deep` to pass
  against chapay's designated requirement (bundle id, Developer ID chain, Team ID
  `K9TKC5GG76`). A forged update then needs the minisign key _and_ the Developer ID certificate.
- **UX:** the automatic check is **on by default**: once about 10 seconds after launch, then at
  most every 24 hours while running ("Check for updates automatically" in Settings › General,
  setting `autoCheckUpdates`). Only the check is automatic. A newer version shows a slim banner
  at the top of the panel ("chapay X is available" · **Update** · ×, dismissed per version) and
  a fuchsia dot on the panel's gear. Update downloads, verifies and installs; the banner then
  says "Restart to update". Settings › About runs the same flow ("Check for updates" →
  "Update to X" → progress → "Restart chapay"). No dialogs, no install without a click, no
  forced restart. Debug builds never check by themselves.
- **Keys:** `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` are secrets in
  the `production` environment, with an offline copy in the owner's password manager. They reach
  only the `tauri bundle` step. Rotation is a bridge release signed with the old key that ships
  the new public key and a new feed path (`updates/v2/latest.json`).
- **Release:** ships with Settings in `0.2.0`, so no release carries only the notify-only check.

## Alternatives rejected

- **A custom domain for the feed before the first updater build** (the spec's recommendation).
  Rejected by the owner for now: it adds DNS and bucket work before 0.2.0, and the bridge
  release that moving later requires is a known, documented procedure.
- **Committing the endpoint in `tauri.conf.json`.** Every `tauri dev` build would then point at
  the production feed, and the host would live in two places (the file and
  `DOWNLOAD_BASE_URL`).
- **Automatic check off by default** (the spec's recommendation). Rejected by the owner: most
  users never open About, so releases would barely reach them. The check sends no version and
  no identifier, and it can be turned off.
- **Sparkle 2** (through `tauri-plugin-sparkle-updater`). Mature, with delta updates and recovery
  of a lost EdDSA key through the Developer ID signature. Rejected because it brings an
  Objective-C framework with XPC services and a young single-maintainer bridge into a Rust/React
  app, deltas are worthless for a 2 MB download, and its standard UI fits poorly in a panel app
  without a Dock icon.
- **Notify only** (PR #45 as is). No keys and no new steps, but six manual steps per update. Its
  GitHub request is removed; About keeps a "Download" fallback to the GitHub release page when an
  in-place install is impossible or fails.
- **GitHub Releases as the feed** (`tauri-action`'s default). `latest` resolves to the web line
  in this monorepo, and `tauri-action` would undo the "build without secrets, then sign" split.
- **CrabNebula Cloud or a dynamic update Worker.** A new vendor or service for problems a static
  file on R2 already solves.

## Consequences

- A new secret with a large blast radius. Losing it strands every installed copy; the only remedy
  is a manual reinstall. Leaking it is dangerous only together with control of the feed, and the
  Developer ID check blocks even that.
- The feed URL (today the `r2.dev` URL) is a permanent contract with every installed copy.
  `DOWNLOAD_BASE_URL` can no longer change without a bridge release.
- `r2.dev` rate limits apply to the feed. If they bite, update checks fail quietly (the banner
  simply does not appear) until the feed moves.
- The release workflow grows by about eight steps and installs `minisign` from Homebrew before
  any secret is on the runner.
- Every current `0.1.0` user must install the first updater release by hand once.
- The Team ID becomes part of the update contract. Moving to another Apple team needs a bridge
  release (TCC would treat the app as new anyway).
- The app's network traffic is the feed request (launch, then daily, plus clicks) and the
  archive download after a click. The GitHub API call from PR #45 is gone.
- Notarization is checked in CI, not on the user's Mac: the installed app re-checks the Apple
  code signature and designated requirement, not the stapled ticket.

## Non-goals

- Delta updates, beta or staged channels, phased rollout.
- Windows and Linux updates.
- Silent installs, or installs and restarts without a click.
- Update analytics or any identifier in update requests (the feed URL has no variables).
- A Homebrew tap (possible later as an extra channel, not as the updater).

## Reopen when

- **The feed must leave `r2.dev`** (rate limits, Cloudflare guidance, or a custom domain is
  wanted): ship a bridge release whose build carries the new endpoint, keep publishing the old
  `r2.dev` feed until that release has reached users, then freeze it on the bridge version.
- The archive grows enough that deltas matter (for example above 50 MB), or users ask for
  background installs.
- The updater key is lost, or the Apple team changes (re-evaluate Sparkle's Developer ID
  rotation).
- `tauri-plugin-updater` gains built-in multi-key support or Apple-signature checks, which would
  replace the bridge-release rotation or the custom Developer ID gate.
- A second desktop platform ships.
