# ADR 0007: desktop updates through tauri-plugin-updater and a static feed on R2

**Status:** Proposed (draft, 2026-10-13). Nothing is implemented. On `main` the desktop app has no
updater and no update check; PR #45 (`feat/settings`) adds an on-click, notify-only check. On
acceptance, this ADR amends the "In-app auto-update" non-goal of
[ADR 0003](0003-release-please-and-desktop-distribution.md) and meets the updater reopen
conditions of ADR 0003 and [ADR 0004](0004-public-hostnames-and-release-variables.md).
**Date:** 2026-10-13.
**Spec:** [docs/specs/2026-10-13-desktop-auto-updater.md](../specs/2026-10-13-desktop-auto-updater.md).

## Context

chapay ships as signed, notarized DMGs on Cloudflare R2, built by `release-desktop.yml` on
`desktop-v*` tags that release-please creates (ADR 0003, ADR 0004). An update today is a manual
download and drag. The installed base is `0.1.0`, which contains no update code. PR #45 adds a
"Check for updates" button that asks the GitHub API and opens the release page.

chapay is a menu-bar (Accessory) app with no Dock icon. It holds Full Disk Access, which macOS
ties to the app's designated requirement. The shipped requirement pins the bundle id
`dev.csdev19.portwatcher` and Team ID `K9TKC5GG76`. The owner prefers local-first behaviour and
minimal network traffic. The repository's GitHub "Latest" release is `web-v0.1.0`, so
`releases/latest/…` URLs cannot serve the desktop line.

## Decision

- **Updater:** `tauri-plugin-updater` (≥ 2.13.2), driven from Rust (`src-tauri/src/update.rs`)
  through three app commands. The webview gets no `updater:*` permission.
- **Feed:** a static `updates/latest.json` in the existing R2 bucket. It has `darwin-aarch64`
  and `darwin-x86_64` entries pointing at immutable `download/<version>/chapay-<arch>.app.tar.gz`
  objects. The feed is served from a **custom domain chosen before the first updater build**,
  because that URL is permanent for every installed copy.
- **Workflow:** the existing `release-desktop.yml` gains the archives and `.sig` files (created
  by `tauri bundle --bundles app,dmg` with `createUpdaterArtifacts` turned on only in CI), and
  checks them (Apple checks on the extracted app, and minisign against the committed public
  key). It writes `latest.json` with `jq` and publishes it **last**, refusing to move it to an
  older version. `tauri-action` is not adopted.
- **Integrity:** `requireSignedVersion: true` from the first release (CLI ≥ 2.12.0). Before
  installing, the app checks that the downloaded `chapay.app` satisfies chapay's Developer ID
  designated requirement. A forged update then needs both the minisign key and the Apple
  certificate.
- **UX and privacy:** every download and install starts from a click in Settings › About ("Update
  to X" → "Restart chapay"). A daily automatic check is an opt-in setting. The feed request uses
  no URL variables, so it carries no app version.
- **Keys:** `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` are secrets in
  the `production` environment, with an offline copy in the owner's password manager. The
  `production` environment is restricted to `main` and the release tags before the first signed
  release. Rotation is a bridge release signed with the old key that ships the new public key
  and a new feed path.

## Alternatives rejected

- **Sparkle 2** (through `tauri-plugin-sparkle-updater`). Mature, with delta updates and recovery
  of a lost EdDSA key through the Developer ID signature. Rejected because it brings an
  Objective-C framework with XPC services and a young single-maintainer bridge into a Rust/React
  app, deltas are worthless for a 2 MB download, and its standard UI fits poorly in a panel app
  without a Dock icon.
- **Notify only** (PR #45 as is). No keys and no new steps. Rejected as the main path because each
  update takes six manual steps, so releases would barely reach users. It stays as the fallback
  ("Download") when an in-place install is not possible.
- **GitHub Releases as the feed** (`tauri-action`'s default). Rejected because `latest` resolves
  to the web line in this monorepo, and `tauri-action` would undo the "build without secrets,
  then sign" split.
- **CrabNebula Cloud or a dynamic update Worker.** Rejected: a new vendor or service for problems
  a static file on R2 already solves.
- **Automatic background updates on by default.** Rejected: they contradict the owner's
  local-first default and add network traffic the user did not start.

## Consequences

- A new secret with a large blast radius. Losing it strands every installed copy, and the only
  remedy is a manual reinstall. Leaking it is dangerous only together with control of the feed,
  and the Developer ID check blocks even that.
- The release workflow grows by about eight steps, and the feed URL becomes a permanent contract.
- Every current `0.1.0` user must install the first updater-enabled release by hand once.
- The Team ID becomes part of the update contract. Moving to another Apple team needs a bridge
  release (TCC would treat the app as new anyway).
- The GitHub API call from PR #45 is replaced by the feed request, so the app talks to one host.
- `releasing.mdx`, `scripts/production-env.sh`, and ADRs 0003 and 0004 need updates in the
  implementing PR.

## Non-goals

- Delta updates, beta or staged channels, phased rollout.
- Windows and Linux updates.
- Silent installs, or installs triggered from the panel.
- Update analytics or any identifier in update requests.
- A Homebrew tap (possible later as an extra channel, not as the updater).

## Reopen when

- The archive grows enough that deltas matter (for example above 50 MB), or users ask for
  background installs.
- The updater key is lost, or the Apple team changes (re-evaluate Sparkle's Developer ID
  rotation).
- `tauri-plugin-updater` gains built-in multi-key support or Apple-signature checks, which would
  replace the bridge-release rotation or the custom Developer ID gate.
- A second desktop platform ships.
