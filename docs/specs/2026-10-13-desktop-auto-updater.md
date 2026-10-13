# Desktop auto-updater — in-app updates for chapay

Date: 2026-10-13 · Status: approved with owner decisions; implemented on `feat/auto-updater` ·
Owner: csdev19

Implementation status: the updater is implemented on branch `feat/auto-updater` (built on
`feat/settings`, PR #45); neither branch is on `main`. No release has run the new workflow steps
yet, and the updater public key in `tauri.conf.json` is a placeholder until the owner commits the
real one. The decision is [ADR 0007](../adr/0007-desktop-updates-through-tauri-updater.md)
(Status: Accepted). Where the owner's decisions below differ from the original recommendations,
the sections that follow were updated to match; section 5 lists what the implementation does
differently from the draft.

## One-minute summary

chapay updates itself with **`tauri-plugin-updater`**, fed by a static `updates/latest.json` on
the same Cloudflare R2 bucket and public URL (`DOWNLOAD_BASE_URL`, today `r2.dev`) that already
serves the DMGs. The release workflow injects that endpoint into the build, adds one signed
`.app.tar.gz` per architecture, and writes the feed **last**, after every file it points at has
been uploaded and checked. chapay checks the feed once at launch and then daily (a setting, on by
default). When a newer version exists, a slim banner at the top of the panel offers **Update**,
and the panel's gear gets a fuchsia dot; Settings › About runs the same flow. Nothing downloads or
installs without a click, and the restart is a click too. Before installing, the app checks that
the downloaded app carries chapay's own Developer ID signature, so a leaked updater key alone
cannot push code to users. Everyone on `0.1.0` downloads the `0.2.0` DMG by hand once; after
that, updates happen inside the app.

| Decision                                                                                            | Why                                                                                                                                                                                   | ADR                                                                                                                                        |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Use `tauri-plugin-updater` (not Sparkle, not notify-only)                                           | First-party for Tauri 2, Rust-only, fits the existing release job; Sparkle's extra features (deltas, Developer ID key recovery) do not pay for an Objective-C framework in a 2 MB app | creates [0007](../adr/0007-desktop-updates-through-tauri-updater.md)                                                                       |
| Host a static `updates/latest.json` on R2, not GitHub Releases                                      | The repo's GitHub "Latest" release is `web-v0.1.0`, so `releases/latest/download/…` cannot serve the desktop line                                                                     | 0007; reuses [0003](../adr/0003-release-please-and-desktop-distribution.md), [0004](../adr/0004-public-hostnames-and-release-variables.md) |
| Serve the feed from the existing `r2.dev` URL; inject the endpoint at release build time            | Owner decision: no custom domain now. Moving later needs a bridge release (ADR 0007's reopen condition). Injection keeps dev builds off the feed                                      | 0007; meets ADR 0004's reopen condition                                                                                                    |
| Write the feed last, and refuse to move it to an older version                                      | The live feed is the release boundary (hub rule)                                                                                                                                      | none (hub rule applied)                                                                                                                    |
| Turn on `requireSignedVersion` from the first release                                               | Stops a crafted feed from pairing a new version number with an old signed artifact; costs nothing because no older signatures exist                                                   | 0007                                                                                                                                       |
| Check the update's Developer ID requirement before installing                                       | The plugin checks only its own minisign signature; this adds Apple's signature as a second key the attacker must also hold                                                            | 0007                                                                                                                                       |
| Check automatically at launch and daily (on by default); install only on a click                    | Owner decision: releases should reach users who never open About. The request carries no version or identifier                                                                        | 0007                                                                                                                                       |
| Show updates in a panel banner and a dot on the gear, and in About                                  | Owner decision: non-invasive, no dialogs, no forced restart                                                                                                                           | 0007                                                                                                                                       |
| Store the updater key in the `production` environment, with an offline copy in the password manager | Same place as the Apple secrets; losing the key strands every installed copy                                                                                                          | none                                                                                                                                       |
| Restrict `production` to `main` and release tags first                                              | The updater key can run code on every installed copy                                                                                                                                  | none (hub rule applied)                                                                                                                    |

**Owner decisions (2026-10-13)** — answers to the draft's open questions

1. **Feed hostname:** the existing R2 public URL (`DOWNLOAD_BASE_URL`), no custom domain. The
   cost is recorded in ADR 0007: `r2.dev` is rate-limited and not meant for production, and the
   URL is baked into installed copies, so moving needs a bridge release.
2. **Automatic check:** on by default, at launch and at most every 24 hours, with a General
   setting to turn it off. Only the check is automatic.
3. **Offline key backup:** still open; the runbook in `releasing.mdx` asks for a password-manager
   copy and recommends a second offline one.
4. **Release order:** the updater ships in the same release as Settings (`0.2.0`).
5. **Panel hint:** yes — a fuchsia dot on the panel footer's gear, plus a banner at the top of
   the panel.

**Out of scope:** delta updates; beta or staged channels; Windows and Linux; a dynamic update
server; update analytics or telemetry; the implementation plan (`docs/plans/` comes after this
spec is approved); renaming the crate, bundle id or repository.

---

## 1. Facts this spec builds on

Each fact was checked on 2026-10-13. The source is named in brackets.

- **Versioning.** release-please owns versions. The `desktop` component uses tags
  `desktop-vX.Y.Z` and bumps `apps/desktop/package.json`, `Cargo.toml` and `Cargo.lock`.
  `tauri.conf.json` reads `"version": "../package.json"`. [`release-please-config.json`,
  `tauri.conf.json`]
- **Release workflow on `main`.** `release-desktop.yml` builds without secrets
  (`tauri build --no-bundle`) for `aarch64` and `x86_64`. It then imports the Developer ID
  certificate into a throwaway keychain and runs `tauri bundle --bundles dmg` with notarization.
  It removes the signing material, then mounts each DMG and runs `codesign --verify`,
  `spctl --assess` and `stapler validate`. Next it writes `SHA256SUMS` and uploads
  `download/<version>/` to R2, checks that those URLs answer, and only then uploads
  `download/latest/` and checks it. Finally it prunes versioned folders down to the last 3 and
  attaches the DMGs and `SHA256SUMS` to the GitHub Release that release-please created.
  [`.github/workflows/release-desktop.yml`]
- **That workflow has not run on a tag yet.** The verify, checksum and safe-order steps landed in
  `214d705` on 2026-10-13, after `desktop-v0.1.0` (2026-10-12) was released. The `0.1.0` GitHub
  Release has only the two DMGs (about 2.2 MB and 2.4 MB). R2 serves
  `download/latest/chapay-arm64.dmg` but returns 404 for `download/latest/SHA256SUMS`. The first
  updater release will therefore also be the first tag run of these steps. [`gh release view`,
  `curl -I`, `git log`]
- **GitHub "Latest" is the web line.** `gh release list` marks `web-v0.1.0` as Latest, not
  `desktop-v0.1.0`. Any URL built on `releases/latest/…` can resolve to the wrong app.
- **Feed host today.** `DOWNLOAD_BASE_URL` is `https://pub-caa84a53955e410bbbb6842091470087.r2.dev`.
  ADR 0004 says to decide the final hostname before the updater lands.
- **Installed base.** `0.1.0` contains neither an updater nor an update check. [`main`, tag
  `desktop-v0.1.0`]
- **Code identity.** The shipped `0.1.0` app has this designated requirement (the rule macOS uses
  to recognise the same app across versions):
  `identifier "dev.csdev19.portwatcher" and anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] and certificate leaf[field.1.2.840.113635.100.6.1.13] and certificate leaf[subject.OU] = K9TKC5GG76`.
  It names the bundle id and Team ID, not a specific certificate, so a renewed Developer ID
  certificate from the same team still satisfies it. [`codesign -d -r-` on the R2 DMG]
- **Accessory app.** `LSUIElement` is set and `lib.rs` sets `ActivationPolicy::Accessory`:
  chapay has no Dock icon and no app menu. [`Info.plist`, `src-tauri/src/lib.rs`]
- **Toolchain.** `@tauri-apps/cli` resolves to `2.11.4` in `bun.lock`, `tauri` to `2.12.0`, and
  Rust is pinned to `1.98.1`. The current plugin is `tauri-plugin-updater` `2.13.3`
  (2026-10-10, MSRV 1.90). [`bun.lock`, `Cargo.lock`, crates.io]
- **PR #45 (`feat/settings`).** `src-tauri/src/update.rs` makes the app's only network call, on
  click. It lists GitHub Releases (`api.github.com/repos/csdev19/port-watcher/releases`), keeps
  non-draft, non-prerelease `desktop-v*` tags and compares them by semver. `About.tsx` shows
  "Check for updates" as the primary button, then "You're on the latest version." or "chapay X is
  available." with a Download button that opens the GitHub release page. The CSP stays strict
  because Rust makes the request.

## 2. Options compared

### 2.1 `tauri-plugin-updater` (Tauri 2) — recommended

**How it works.** The app config has a `pubkey` (minisign/Ed25519) and a list of `endpoints`. On
`check()`, the plugin requests the endpoints in order and moves to the next one only on a non-2xx
response. The response can be a **static JSON** file:

```json
{
  "version": "0.3.0",
  "notes": "…",
  "pub_date": "2026-11-01T12:00:00Z",
  "platforms": {
    "darwin-aarch64": { "url": "https://…/chapay-arm64.app.tar.gz", "signature": "<contents of .sig>" },
    "darwin-x86_64":  { "url": "https://…/chapay-x64.app.tar.gz",   "signature": "<contents of .sig>" }
  }
}
```

It can also be a **dynamic server** that returns `204` for "no update" and `200` with the same
fields for one release. Endpoint URLs may contain `{{target}}`, `{{arch}}` and
`{{current_version}}`. The whole static file is validated, so every platform entry must be well
formed. `signature` holds the `.sig` file's contents, not a URL. TLS is enforced in release builds
unless `dangerousInsecureTransportProtocol` is set. An update is offered only when its version is
greater than the running one; `allowDowngrades` is a config-only flag (since 2.12.0), off by
default. [Tauri updater docs; plugin `config.rs`, `CHANGELOG.md`]

**Artifacts.** `bundle.createUpdaterArtifacts: true` makes the bundler produce
`chapay.app.tar.gz` (the update) and `chapay.app.tar.gz.sig` next to the `.app`. The CLI signs
with `TAURI_SIGNING_PRIVATE_KEY` (path or contents) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
`.env` files are not read. Keys come from `tauri signer generate`. Since **CLI 2.12.0** the
signature's trusted comment records `version:<app version>`. Plugin `requireSignedVersion` then
rejects a feed whose `version` differs from the signed one. [Tauri updater docs; tauri-cli
`CHANGELOG.md` 2.12.0; `updater_signature.rs`]

**Install on macOS** (plugin 2.13.3 source). The plugin downloads the archive into memory,
verifies the minisign signature, and checks the signed version against the announced one. It
then extracts into a temp directory on the same volume and swaps the bundles atomically with
`renamex_np(RENAME_SWAP)`. Where swapping is unsupported it falls back to two renames with a
restore. If the move is denied, it asks for an administrator password through AppleScript
(`do shell script … with administrator privileges`). Since 2.13.2 a failed install no longer
deletes the installed app. The running process continues until the app calls `app.restart()`.
[`plugins/updater/src/updater.rs`, `CHANGELOG.md` 2.13.2]

**What `tauri-action` would add.** It builds, uploads to a GitHub Release and, by default, writes
a `latest.json` whose URLs point at that release's assets. Without a tag it uses
`releases/latest/download/…`, and its README warns that this breaks when the repository has other
releases. Here, Latest is `web-v0.1.0`. Its build step would also undo the deliberate
"build without secrets, then sign" split in our workflow. **Our custom workflow stays; we
generate `latest.json` ourselves with `jq`.** [tauri-action README]

**In production.** Jan (`janhq/jan`) lists `https://apps.jan.ai/update-check` and then
`…/releases/latest/download/latest.json`. Clash Verge Rev uses a fixed `updater` release tag to
host `update.json`, a workaround for the same "Latest release" problem. Both read their pubkey
from `tauri.conf.json`. [their `tauri.conf.json` on GitHub]

**Fit.** Rust-only, no new runtime and no native framework. Signing is one more step in the
existing `tauri bundle` call, and R2 already exists.

**Key blast radius.** The updater does **not** check Apple's signature on the update. With the
minisign key plus control of the feed (R2 write access, the DNS or the Cloudflare account), an
attacker can install arbitrary code on every copy that checks for updates. Section 3.6 closes
this with a Developer ID check before installing. **Loss:** the docs state that losing the key
means "you will NOT be able to publish new updates to the users that have the app already
installed". There is no recovery path, only a manual reinstall.

**UX in a menu-bar app.** There is no built-in UI, so the app builds its own. That suits About.

**Effort.** Medium: one plugin, a few Rust commands, About states, and about 8 workflow steps.
**Maintenance:** low; Dependabot already bumps cargo and npm.

**Strongest argument against.** The key cannot be recovered or rotated by the framework, and the
updater trusts the minisign key alone. A single secret becomes the root of trust for every
installed copy. The Developer ID check and the runbook below exist because of this.

**Pitfalls found while reading the source** (to confirm in the rehearsal run):

- **`--bundles dmg` probably produces no updater archive.** The bundler creates the archive when
  `PackageType::MacOsBundle` is among the _requested_ types. A DMG-only request builds the `.app`
  internally but does not list it. Use `--bundles app,dmg`. (Inferred from
  `tauri-bundler/src/bundle.rs`; verify.)
- **CLI below 2.12.0 signs without a version.** With `requireSignedVersion` on, every update would
  then be rejected. Bump `@tauri-apps/cli` to at least 2.12.0 first.
- **The archive is not versioned in its name** (`chapay.app.tar.gz` under each target's
  `bundle/macos/`), and the Rust cache can restore an old one. Collect it by exact path and
  rename it, as the DMG step already does.
- **Translocated or read-only copies cannot update.** A copy run from the mounted DMG or from a
  quarantined `~/Downloads` runs from a read-only path. The install then fails or asks for an
  admin password. About must say "Move chapay to Applications to update" instead of a raw error.
- **`createUpdaterArtifacts` on in `tauri.conf.json` breaks local bundles** that have no private
  key. Keep it off in the file and turn it on only in the release job (hub,
  [stacks/desktop-tauri](https://github.com/csdev19/general-knowledge/blob/main/stacks/desktop-tauri.md)).

### 2.2 Sparkle 2

**How it works.** Sparkle is the standard native updater. An `appcast.xml` (RSS) lists versions,
and each enclosure carries an EdDSA signature. `generate_keys` creates the key in the login
Keychain (`-x` exports it). `generate_appcast` writes the feed and **delta** archives. Sparkle
ships a standard UI and, by default, checks every 24 hours; it asks for permission on the second
launch. [sparkle-project.org/documentation]

**From Tauri.** Since 2025-12 there is `tauri-plugin-sparkle-updater` (ahonn, 0.3.0, about 29
GitHub stars, around 23 k crate downloads, macOS only). It wraps a `sparkle-updater` Rust binding.
A script downloads `Sparkle.framework`, `bundle.macOS.frameworks` embeds it, and `SUFeedURL` and
`SUPublicEDKey` go into `Info.plist`. Signing the nested XPC services is not covered in its README.
[crates.io; GitHub README]

**Fit.** Deltas are worthless at a 2.2 MB download. The appcast must be regenerated from the live
feed, not from a clean checkout (hub, Swift page). A third binary runtime (an Objective-C
framework with XPC services) would enter a signed bundle that our workflow signs and verifies.

**Key blast radius.** As for Tauri, a key alone lets an attacker sign updates. Sparkle, however,
also checks that the update's Apple code signature matches, and its documentation describes
**recovering a lost EdDSA key by rotating through the Developer ID signature** ("you can still sign
new updates for Developer ID signed applications through key rotation"). That is the one real
advantage over Tauri. (The hub's Swift page says the key has "no recovery path"; Sparkle's own
docs say otherwise for Developer ID apps. That hub line should be corrected separately.)

**UX.** Sparkle's standard windows are a poor fit for a non-activating panel app without a Dock
icon. A custom user driver would be needed anyway.

**Effort.** High. **Maintenance:** a small single-maintainer bridge, a framework version to keep
in step, and nested-code signing.

**Strongest argument against.** It brings an Objective-C framework, XPC services and a young
third-party bridge into a Rust/React app. Its two real advantages are deltas, irrelevant at
2 MB, and key-loss recovery. Section 3.6's Developer ID check covers half of the second one: it
protects against a key _leak_, though not a key _loss_.

### 2.3 Notify only (what PR #45 ships)

**How it works.** On click, Rust asks the GitHub API for releases and compares versions. The user
downloads the DMG and drags it over the old app.

**Fit.** It already exists, needs no new keys, and adds no workflow steps. Its blast radius is
zero beyond what the Developer ID certificate already carries.

**UX.** Six manual steps per update (open the browser, download, open the DMG, drag, replace,
relaunch). Unauthenticated GitHub API calls are limited to 60 per hour per IP.

**Strongest argument against.** Few users take six steps for a small utility. Each release then
reaches only the users who happen to open About and are willing to reinstall. This option remains
the **fallback**: if the in-app install fails, About still offers "Download".

### 2.4 Others, briefly

- **Homebrew cask.** chapay is not in Homebrew. A personal tap means another repository to bump
  on every release. Casks marked `auto_updates true` are skipped by `brew upgrade` unless
  `--greedy`, so a tap adds a distribution channel, not an updater. Worth having later for
  developers; it does not replace an in-app path.
- **CrabNebula Cloud.** A hosted CDN and update endpoint for Tauri
  (`cdn.crabnebula.app/update/ORG/APP/{{target}}-{{arch}}/{{current_version}}`) with download
  metrics. It still uses the same minisign key. It would move hosting off R2, add a vendor and an
  account, and send `current_version` to a third party. Current pricing was not found;
  2024 figures were €5 per 10 k downloads with an open-source discount. Not justified while R2
  works.
- **A dynamic update server** (a Worker reading R2). This would allow per-version answers such as
  key-rotation bridges. A static file can do the same with a second feed path (section 3.5), and
  needs no new service.

## 3. Recommended design

### 3.1 Architecture

```text
Panel banner + gear dot (App.tsx)     Settings › About (React)
   │ invoke("update_status" | "update_check" | "update_install" | "update_restart")
   │ listen("update-status")  ← every state change, to every window
   ▼
src-tauri/src/update/  (owns the updater and its state; no updater:* permission anywhere)
   ├─ check:    UpdaterExt::updater_builder() → GET $DOWNLOAD_BASE_URL/updates/latest.json
   │            (at launch + daily when autoCheckUpdates is on, or on a click)
   ├─ install:  Update::download() → verify minisign + signed version (plugin)
   │            → unpack to temp → codesign --verify --strict --deep -R <chapay DR> (ours)
   │            → Update::install(bytes)  (atomic bundle swap)
   └─ restart:  AppHandle::restart()
```

- **Rust owns the updater**, like the kill policy in
  [ADR 0006](../adr/0006-kill-policy-enforced-in-rust.md). The webview calls four app commands
  and listens to one event. Capabilities do not gain `updater:default`, so a webview bug cannot
  install anything.
- **One network destination.** The feed replaces the GitHub API call in PR #45's `update.rs`. The
  "Release notes" and fallback "Download" buttons still open GitHub in the browser, which is the
  user's choice. The CSP stays as it is.
- **Config** in `tauri.conf.json` under `plugins.updater`: `pubkey` (the public key's contents;
  a placeholder until the owner commits it), `endpoints: []` and `requireSignedVersion: true`.
  The release workflow injects the endpoint (`$DOWNLOAD_BASE_URL/updates/latest.json`, no URL
  variables, so the request carries no version) with `tauri build --config`. Local and dev
  builds have no endpoint, show "Updates are off in this build" and never contact the feed.
  `bundle.createUpdaterArtifacts` stays unset in the file.
- **Versions:** `tauri-plugin-updater` ≥ 2.13.2 (safe macOS install), `@tauri-apps/cli` ≥ 2.12.0
  (signed version).

### 3.2 Release workflow changes, step by step

Each step names the existing step it extends. Publishing steps keep their
`if: startsWith(github.ref, 'refs/tags/')` guard.

1. **Sign, notarize & package.** Add `TAURI_SIGNING_PRIVATE_KEY` and
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` from `secrets.` to this step's `env` only. Like the Apple
   secrets, they reach the machine only after everything that runs third-party build code has
   finished. Change the command to
   `tauri bundle --target "$target" --bundles app,dmg --config '{"bundle":{"createUpdaterArtifacts":true}}'`.
   (Verify that `tauri bundle` accepts `--config`; otherwise use a `tauri.release.conf.json`
   merged by the same flag on `tauri build`.)
2. **Remove signing material.** Nothing to delete: the key is only in the environment. Make sure
   no step writes it to disk.
3. **Collect.** Also copy, by exact path, `<target>/release/bundle/macos/chapay.app.tar.gz` and
   `.sig` to `chapay-${VERSION}-{arm64,x64}.app.tar.gz` and `.sig`.
4. **Verify.** Keep the DMG checks and add, per architecture:
   - extract the archive to a temp folder, then run `codesign --verify --deep --strict`,
     `codesign --verify -R='<chapay DR>'`, `spctl --assess --type execute` and
     `stapler validate` on the extracted `chapay.app`;
   - verify the `.sig` against the **committed** public key: base64-decode it and run
     `minisign -V -P <pubkey> -m <archive> -x <decoded sig>`, and check that the trusted comment
     contains `version:${VERSION}`. This catches a secret that does not match `tauri.conf.json`
     before any user does.
5. **Checksums.** Add the two archives to `SHA256SUMS`. The `.sig` files are signatures and do
   not need a hash. Both `SHA256SUMS` files (release names and R2 names) gain the archive lines.
6. **Write the feed (local only).** Use `jq` to build `latest.json` with `version`, `notes` (one
   line plus the GitHub Release URL), `pub_date` (UTC, RFC 3339) and `platforms.darwin-aarch64`
   and `darwin-x86_64`. Each `url` points at `$DOWNLOAD_BASE_URL/download/${VERSION}/chapay-<arch>.app.tar.gz`,
   the immutable copy, never `latest/`. Each `signature` is the `.sig` file's contents. The
   endpoint is injected from the same `DOWNLOAD_BASE_URL`, so the feed and the build cannot
   disagree about the host; the verify step also greps each built binary for the endpoint.
   (Implemented in `apps/desktop/scripts/updater-feed.sh`, with tests.)
7. **Publish versioned.** Also upload the two archives and their `.sig` files to
   `download/${VERSION}/` with the immutable cache header.
8. **Verify versioned URLs.** Add the four new paths.
9. **Publish latest / Verify latest.** No change. `latest/` stays the DMG alias for the landing;
   the archives do not need a `latest/` copy.
10. **Publish the feed (new, last publishing step).** Read the live `updates/latest.json`
    straight from the bucket (S3 API, not a cache), if there is one, and **refuse to continue**
    if its version is greater than `${VERSION}`. A rerun of an old tag must never move the feed
    backwards. The same version is republished rather than refused: a rerun re-signs and
    re-uploads that version's archives, and a feed left with the old signatures would make
    every install fail its signature check. Then upload `updates/latest.json` with
    `public, max-age=0, must-revalidate` and `application/json`.
11. **Verify the feed (new).** `curl` it, check `.version == VERSION`, and `HEAD` each platform
    `url`.
12. **Prune.** No change in logic. It lists only `download/` and the feed points at the newest
    version, so the feed's targets are never pruned. Add a comment saying so.
13. **Attach to the GitHub Release.** Also attach the archives, `.sig` files and `latest.json`,
    for transparency and as a manual source. They are not an update endpoint.
14. **Rehearsal (`workflow_dispatch`).** Signs with the real key and adds the archives, `.sig`
    files and `latest.json` to the workflow artifact. It still publishes nothing.

The resulting order is: versioned DMGs and archives → check → `latest/` DMGs → check → **feed** →
check. A failure anywhere before the feed leaves every installed copy on the previous version
(hub, [distribution/README](https://github.com/csdev19/general-knowledge/blob/main/distribution/README.md)).

Docs to update in the implementation PR: `releasing.mdx` (new secrets, the `updates/` path,
rehearsal outputs), `scripts/production-env.sh` (known names), and amendment notes on ADRs 0003
and 0004.

### 3.3 Feed hostname (decided: the existing `r2.dev` URL)

Every installed copy requests the feed URL it was built with, forever. The URLs _inside_ the feed
can change on any release; the feed URL cannot.

The draft recommended a custom domain before the first updater build. **The owner chose the
existing R2 public URL** (`DOWNLOAD_BASE_URL`, a `pub-….r2.dev` URL). Consequences, recorded in
ADR 0007:

- Cloudflare rate-limits `r2.dev` URLs and documents them as not meant for production. One small
  JSON request per copy per day is far below any limit at chapay's scale; if the limit bites,
  checks fail quietly (no banner) until the feed moves.
- `DOWNLOAD_BASE_URL` becomes part of every installed copy. Changing the variable no longer only
  needs a web release (ADR 0004): it needs a **bridge release** — a release built with the new
  endpoint, published to the old feed as well, which stays alive (frozen on the bridge version)
  until the installed base has moved.

The endpoint is not committed: the release workflow injects `$DOWNLOAD_BASE_URL/updates/latest.json`
at build time, and refuses to build when the variable is not an HTTPS URL. No second endpoint is
added, because the plugin falls back only on non-2xx responses (behaviour on a DNS or TLS failure
is unverified) and because every extra endpoint is one more permanent host.

### 3.4 Key management runbook

**Generate (once, on the owner's Mac).**

```sh
bunx tauri signer generate -w ~/.tauri/chapay-updater.key   # password from the password manager
```

**Store.**

- In the password manager, one item "chapay updater signing key" holding the private key file's
  contents, its password, the public key, the creation date and the key id from the public key's
  comment line.
- In GitHub, environment `production` secrets: `TAURI_SIGNING_PRIVATE_KEY` (the file contents)
  and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
- In the repository: the public key in `tauri.conf.json`.
- Then delete `~/.tauri/chapay-updater.key`, so the key lives in exactly two places.

**Before the first signed release.** The `production` environment is already restricted to
`main` plus the `desktop-v*` and `web-v*` tags (set on 2026-10-13; the `release-please.yml`
comment saying it has no protection rules predates that and should be updated). What remains is
turning off administrator bypass (hub,
[public-repo-production-protection](https://github.com/csdev19/general-knowledge/blob/main/monorepos/public-repo-production-protection.md)),
because after this change the environment holds a key that can reach every user.

**Planned rotation (key suspected leaked, or routine).** Tauri cannot hold two public keys. A
rotation is a **bridge release** plus a **new feed path**:

1. Generate K2 and store it as above, under a new password-manager item.
2. Release N, still signed with K1, ships K2's public key **and** a new endpoint
   `updates/v2/latest.json` (change `FEED_PATH` in `release-desktop.yml`; the endpoint is
   injected from it).
3. Release N updates the old feed `updates/latest.json` for the last time. From then on, the
   workflow writes only `updates/v2/latest.json` and signs with K2.
4. A copy on any version below N reads the old feed, gets N (verified with K1), restarts, and
   from then on reads the v2 feed with K2.

The old feed stays frozen on N for good. It must not be deleted, because older copies still read
it.

**Leaked key.** On its own, a leaked key cannot reach users: they fetch the feed over HTTPS from
our host, and section 3.6 also demands our Developer ID signature. Treat a leak as urgent anyway:
rotate as above, and check R2 tokens and Cloudflare access.

**Lost key (every copy).** No bridge is possible, so every installed copy is stranded on its
version. The remedy is the `0.1.0` migration again: ship a release with a new key and endpoint,
and ask users to download it by hand (landing, release notes). Installed copies cannot be told
in-app: their feed can no longer be signed for. That is why the second offline copy (open
question 3) matters.

### 3.5 Migration of the `0.1.0` installed base

`0.1.0` has neither an updater nor a check, so nothing inside it can say that an update exists.

- **One manual step for everyone.** Download the new DMG from the landing and drag it over
  `/Applications/chapay.app`. The bundle id and Team ID are unchanged, so Full Disk Access should
  carry over (section 3.7).
- **Where users learn about it.** The landing, the GitHub release notes for the first updater
  release ("This release adds in-app updates. Install it once from the DMG; later versions
  install from Settings › About."), and any channel the owner uses. There is no in-app message,
  because `0.1.0` cannot show one.
- Settings and the updater ship together in `0.2.0` (owner decision 4), so no release carries
  only the notify-only check.
- From the first updater release on, About never needs migration copy.

### 3.6 Developer ID gate before installing (defence in depth)

The plugin trusts the minisign key alone. chapay splits the install into steps:

1. `Update::download()` returns the verified bytes.
2. chapay extracts them to a temp folder.
3. It runs `codesign --verify --strict --deep -R '=<designated requirement>'` on the extracted
   `chapay.app`. The requirement is the one quoted in section 1, Developer ID markers included,
   compiled in as a constant (`src-tauri/src/update/identity.rs`).
4. Only then does it call `Update::install(bytes)`.

If the check fails, chapay installs nothing; the banner and About say "This update isn't signed by
chapay's developer", and About offers "Download instead". An attacker now needs the minisign key,
the Developer ID certificate _and_ control of the feed. The Developer ID requirement is the one
macOS already uses to recognise chapay.

**What the gate checks, exactly** (as implemented):

- The plugin installs an archive by dropping each entry's first path component into a temp
  folder that becomes the new bundle. The gate therefore refuses any archive that is not exactly
  one `chapay.app` tree: every entry must start with `chapay.app`, contain no `..`, absolute or
  `.` component, and be a plain file, folder or symlink. It unpacks the same bytes with
  `tar`'s `unpack_in` (which also refuses writes through symlinks that leave the folder). Given
  that shape, what is checked is what the plugin installs.
- `codesign` exit status 0 passes. Status 3 (valid signature, wrong requirement: another team,
  another bundle id, ad hoc) and anything else (unsigned, modified, codesign missing) refuse.
- Verified on 2026-10-13 against real files: the shipped `0.1.0` app passes; the same app
  re-signed ad hoc fails with "code failed to satisfy specified code requirement(s)"; the same
  app with one byte appended to `Info.plist` fails as modified.

**What it does not check:** notarization (the stapled ticket is checked in CI, not on the user's
Mac; the downloaded files carry no quarantine flag, so Gatekeeper does not assess them either),
and whether the new app's `CFBundleShortVersionString` equals the feed's version
(`requireSignedVersion` already binds the archive to that version).

The cost is a second extraction (2 MB) and about 100 lines of Rust. It also keeps the Team ID
fixed. Moving to another Apple team would need a bridge release, which matches how TCC treats a
team change anyway.

### 3.7 Full Disk Access after an update

**Expected: the grant survives an in-place update.** Apple DTS: "macOS tracks code identity using
the code's designated requirement … Sign your code with a stable code-signing identity … Developer
ID, for direct distribution" (Apple Developer Forums 795739). chapay's requirement pins the bundle
id and the Team ID (section 1). The updater swaps the bundle at the same path. A Developer ID
update from the same team therefore satisfies the requirement the TCC entry was stored with.
Since Ventura, macOS also allows apps from the same team to replace each other without an "App
Management" prompt (Eclectic Light, 2022-06-17).

**Not yet verified for chapay.** No chapay update has ever run. Reports of grants lost on
update (Claude Code issues) involve a versioned binary path or an unstable signature, neither of
which applies here. They still show the claim must be tested. **Acceptance test** for the first
updater release:

1. Install the previous version from its DMG and grant FDA.
2. Update through About.
3. After the restart, the Permissions screen still reports FDA as granted.
4. `fda.rs` still opens the TCC database.

Run it on Apple silicon and Intel if possible.

### 3.8 UX

**Settings › About.** The fuchsia primary button is the state machine:

| State               | Primary button (fuchsia)      | Status line                                          |
| ------------------- | ----------------------------- | ---------------------------------------------------- |
| updates off (dev)   | Check for updates (disabled)  | Updates are off in this build.                       |
| idle                | Check for updates             | —                                                    |
| checking            | Checking… (spinner, disabled) | —                                                    |
| up to date          | Check for updates             | You're on the latest version.                        |
| check failed        | Check for updates             | Couldn't check for updates.                          |
| available           | **Update to 0.3.0**           | chapay 0.3.0 is available.                           |
| downloading         | Updating… (spinner, disabled) | Downloading 1.4 / 2.2 MB                             |
| installed           | **Restart chapay**            | 0.3.0 is installed. Restart chapay to finish.        |
| cannot install here | Download                      | Move chapay to Applications to update in place.      |
| failed              | Try again                     | (reason, e.g. "Couldn't update.") · Download instead |

**Panel banner** (owner decision 2 and 5). A slim bar at the top of the panel, above the search:

| State               | Banner                                                  |
| ------------------- | ------------------------------------------------------- |
| available           | chapay 0.3.0 is available · **Update** (fuchsia) · ×    |
| downloading         | Updating to 0.3.0… 45% (thin fuchsia progress line)     |
| installed           | chapay 0.3.0 is ready · **Restart to update** (fuchsia) |
| failed              | (reason) · Try again · ×                                |
| cannot install here | Move chapay to Applications to update. · ×              |
| anything else       | hidden                                                  |

× dismisses the banner for that version only (setting `dismissedUpdateVersion`); a newer version
shows it again, and "Restart to update" always shows. While any version is waiting, the panel
footer's gear carries a small fuchsia dot (its accessible name says which version). Panel and
About read the same Rust state through the `update-status` event, so a click in one updates both.

- A download is about 2 MB, so there is no background pre-download. One click downloads,
  verifies and installs, which takes seconds. A restart needs its own click, because chapay may
  be mid-kill-confirmation in the panel. No dialogs anywhere; every message is inline.
- **Restarting loses nothing.** chapay holds no session state: the port list is re-read, and
  settings are on disk. The restart re-registers the global shortcut. If the user never clicks
  Restart, the new version runs at the next launch. The banner and About show the restart for as
  long as this process runs.
- **No Dock icon** means no badge and no app menu: the banner, the gear dot and About carry it.
- **Settings › General › Updates** has "Check for updates automatically" ("Once when chapay
  opens, then daily. Nothing else is sent."), bound to `autoCheckUpdates`, **on by default**.
  When on: one check about 10 seconds after launch, then at most every 24 hours while running
  (wall-clock, so a Mac that slept overnight checks on wake). The automatic check never replaces
  an offer on screen or interrupts a download, and it never downloads.
- **Debug builds** skip the automatic check, and builds without an injected endpoint (every local
  build) cannot check at all, so `tauri dev` never contacts the production feed.

### 3.9 Privacy

| Mode                         | When the app goes online                                     | What leaves the machine                                                                                                                         |
| ---------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| PR #45 (replaced)            | On click                                                     | IP address, `User-Agent: chapay`, to `api.github.com`                                                                                           |
| Default (automatic check on) | ~10 s after launch, then every 24 h; on click; when updating | IP address, `User-Agent: chapay`, to the feed host (Cloudflare R2). The archive request shows the architecture. No app version, id or settings. |
| Automatic check off          | On click; when downloading after a click                     | Same as above, only when the user asks                                                                                                          |

No URL variables are used, so the request does not carry `current_version`. The User-Agent is
overridden with the builder's `header()` to `chapay`.

### 3.10 Security summary

- **HTTPS only.** The plugin enforces TLS in release builds; `dangerous*` flags stay unset.
- **HTTPS archives too.** The plugin checks only the endpoint's scheme; chapay also refuses a feed
  whose archive URL is not HTTPS.
- **No downgrades.** chapay sets its own comparator: only a strictly newer plain `X.Y.Z` is an
  update (no pre-release or build-tagged version), and with a comparator set the plugin ignores
  `allowDowngrades`, which also stays off. To recover from a bad release, ship a higher version
  that reverts it. Never point the feed at an older one; installed copies would ignore it anyway.
- **No replay of old releases.** `requireSignedVersion` binds each archive to its version. The
  workflow also refuses to move the feed backwards.
- **An attacker with R2 write access only** _can_ withhold updates (freeze the feed or serve
  malformed JSON), delete files, or swap the DMGs for new installs. Gatekeeper would reject an
  altered DMG without our Developer ID signature and notarization. They _cannot_ install code on
  existing copies: they lack the minisign key, the signed version must match, and the Developer ID
  gate applies.
- **With the minisign key and R2 write access**, they are still stopped by the Developer ID gate
  (section 3.6). Without that gate, this would be code execution on every copy that updates.
- **With the Developer ID certificate as well**, it is game over, as it already is today for new
  installs.

## 4. Risks

- **An updater bug is the one bug you cannot fix by shipping an update** (hub, Swift page). Ship
  the first updater release only after a full rehearsal, _and_ test an update from it to a
  throwaway higher version in a test bucket before users depend on it.
- **The feed hostname is permanent**, and it is the rate-limited `r2.dev` URL (owner decision 1).
  Leaving it is only possible through a bridge release (ADR 0007, "Reopen when").
- **Key loss** means a manual reinstall for everyone (section 3.4).
- **The first tag run of the new verify and checksum steps** will happen together with the first
  updater steps. Cut one release with the current workflow first, so the two changes fail
  separately. That release would also give `0.1.0` users their manual hop.
- **Pitfalls inferred from source** (section 2.1) are unverified until the rehearsal run.
- **TCC persistence** is expected but not observed (section 3.7).

## 5. As implemented: differences from the draft

Each item was checked against `tauri-plugin-updater` 2.13.3 and `tauri-cli` 2.12.2 source.

- **Owner decisions** changed the feed host (`r2.dev`, section 3.3), the automatic check (on by
  default) and the UX (panel banner and gear dot, section 3.8).
- **Endpoint injected, not committed** (section 3.1): `tauri build --no-bundle --config` sets
  `TAURI_CONFIG`, which `tauri-build` merges into the compiled config and reruns on. Confirmed
  with a local release build: the injected URL is in the binary. The workflow greps each built
  app for it.
- **Same-version reruns republish the feed** instead of refusing (section 3.2, step 10).
- **Four commands, not three**: `update_status` lets a window that opens later (Settings) show
  the state the panel already has. State changes are broadcast as `update-status`.
- **Archive shape check** in the Developer ID gate (section 3.6), because of how the plugin
  unpacks archives.
- **`--bundles app,dmg` confirmed** from `tauri-bundler`: the updater archive is only written when
  the app bundle type is requested.
- **The bundler only warns** when the private key does not match the committed public key, so
  the workflow verifies every `.sig` with `minisign` (from Homebrew, installed before any secret
  is on the runner) against the committed key, and checks the trusted comment carries
  `version:<VERSION>`.
- **Public key placeholder.** `plugins.updater.pubkey` is `CHAPAY_UPDATER_PUBLIC_KEY_NOT_SET`
  until the owner commits the real key; the workflow's first step refuses to build until it is
  a minisign public key.
- **GitHub API check removed.** `update.rs`'s GitHub path, its `check_for_update` command and the
  `ureq` dependency are gone; `arch_label` stays.

## 6. References

- Tauri 2 updater plugin docs — https://v2.tauri.app/plugin/updater/
- `tauri-plugin-updater` source and changelog (2.13.3) —
  https://github.com/tauri-apps/plugins-workspace/tree/v2/plugins/updater
- Tauri CLI changelog (2.12.0: signed version in trusted comment) —
  https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-cli/CHANGELOG.md
- Tauri CLI updater signing (`updater_signature.rs`) —
  https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-cli/src/helpers/updater_signature.rs
- Tauri bundler (when the updater archive is built) —
  https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-bundler/src/bundle.rs
- tauri-action — https://github.com/tauri-apps/tauri-action
- Jan updater config — https://github.com/janhq/jan/blob/main/src-tauri/tauri.conf.json
- Clash Verge Rev updater config —
  https://github.com/clash-verge-rev/clash-verge-rev/blob/dev/src-tauri/tauri.conf.json
- Sparkle documentation — https://sparkle-project.org/documentation/
- tauri-plugin-sparkle-updater — https://github.com/ahonn/tauri-plugin-sparkle-updater
- Apple DTS on designated requirements and updates — https://developer.apple.com/forums/thread/795739
- TN3127, Inside Code Signing: Requirements —
  https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements
- Ventura App Management (same-team updates) —
  https://eclecticlight.co/2022/06/17/app-security-changes-coming-in-ventura/
- TCC grants lost on update with versioned paths (counter-example) —
  https://claudeissues.com/issue/30608-bug-macos-tcc-permissions-reset-on-every-claude-code-update-due-to-versioned-bin
- CrabNebula Cloud updater — https://docs.crabnebula.dev/cloud/auto-updates/tauri/
- Hub: [distribution/README](https://github.com/csdev19/general-knowledge/blob/main/distribution/README.md),
  [distribution/swift-xcode-macos](https://github.com/csdev19/general-knowledge/blob/main/distribution/swift-xcode-macos.md),
  [stacks/desktop-tauri](https://github.com/csdev19/general-knowledge/blob/main/stacks/desktop-tauri.md),
  [conventions/app-bundle-identifiers](https://github.com/csdev19/general-knowledge/blob/main/conventions/app-bundle-identifiers.md),
  [monorepos/public-repo-production-protection](https://github.com/csdev19/general-knowledge/blob/main/monorepos/public-repo-production-protection.md)
