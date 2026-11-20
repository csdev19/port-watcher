# Post-0.1.0 audit backlog

**Ticket:** [NIW2-345](https://linear.app/niway/issue/NIW2-345/chapay-resolve-the-post-010-audit-findings-code-architecture-docs)
**Status:** open. Nothing below is fixed yet. This is a working plan: the PR
that resolves the last item deletes this file.

## Summary

On 2026-10-12, right after desktop 0.1.0 and web 0.1.0 shipped, five read-only
review agents audited `main` at `9803576`: code quality, architecture,
documentation, security, and a general product review. This file is their
findings, deduplicated and ranked.

**Verdict:** there are no critical security issues, and the Rust kill path is
well guarded:

- it refuses PIDs below 100, its own PID, and other users' processes;
- it re-checks that the process is still listening;
- it compares the process start time, so a reused PID is not killed;
- it sends SIGTERM, then SIGKILL after 2 s.

The weak spots are at the edges: one dangerous keyboard shortcut, the
first-run experience, CI that never runs the Rust code, and a lot of
documentation inherited from the monorepo template.

**Legend:**

- **[V]** was verified by hand after the audit.
- **[C]** was confirmed by an agent tracing the code.
- **[S]** is suspected and needs a runtime check.

Already in flight, not repeated below: PR #33 fixes the tray left click (it
showed the Quit menu, a tray-icon 0.24.2 bug) and adds the web favicon.

## Open questions

| Question                                                                    | Options                                                                 | Recommendation                                                                     |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| ⌘⌫ instant kill for dev processes                                           | Keep it outside the search box, or always require a double confirmation | Keep it, but never while the search input has focus (item 1.1)                     |
| Template TS packages (`domain`, `application`, `infra-*`, `tokens`, `i18n`) | Keep them dormant, or archive them                                      | Owner decision. They were kept deliberately in #27; see item 3.1                   |
| Bundle id `dev.csdev19.portwatcher`                                         | Rename it to a chapay id before there are many users, or keep it        | Decide before wide distribution: a rename resets macOS permissions and preferences |

## Batch 1: user-facing (target: desktop and web 0.1.2)

### 1.1 ⌘⌫ in the search box kills a process without confirmation [V]

`App.tsx:202-238` registers a window-level keydown handler. It only skips
`[data-list-shortcuts="off"]` (the watch form), not the search input. For a
`dev` row, a keyboard kill skips the two-step confirmation
(`use-kill-confirm.ts:52`).

The failure goes like this:

1. The user opens the panel. The search box takes focus and the first row is
   selected.
2. They type, then press ⌘⌫ to clear the field, the standard macOS shortcut.
3. The selected dev server receives SIGTERM, then SIGKILL.

**Fix:** ignore ⌘⌫ as a kill when the event target is the search input. Add a
test for it.

### 1.2 Documents-folder permission prompt [C]

`src-tauri/src/ports/project.rs::detect_project` runs on every `list_ports`
call. For each listener, it walks every ancestor of the process cwd, calls
`is_file()` or `exists()` on `package.json`, `Cargo.toml` and `.git`, then
reads `package.json`. Dev servers under `~/Documents` make chapay touch a
TCC-protected folder, so macOS asks for access.

**Fix:**

- Skip filesystem probing under `~/Documents`, `~/Desktop`, `~/Downloads` and
  `~/Library/Mobile Documents`, and name the project from the last cwd path
  component instead.
- Stop the ancestor walk at `$HOME`.
- Cap the `package.json` read at 1 MiB and skip symlinks. Any local process
  can point its cwd at a huge file, which stalls polling (local DoS).
- Do not rely on a "denied" fallback: each poll would hit the denied path
  again.
- To verify, start a dev server inside `~/Documents` and watch for the prompt.

### 1.3 The landing says "chapaq" [V]

`apps/fullstack-fn-only/src/routes/index.tsx:57,120,257` shows "chapaq" in the
wordmark, an aria-label and the footer, and the asset is
`public/chapaq-mark.png`. **Fix:** use "chapay" and rename the asset.

### 1.4 The main download button is always Apple silicon [C]

`DownloadButton` links `chapay-arm64.dmg`. Intel is a small text link, so an
Intel user downloads a DMG that does not open. **Fix:** two explicit buttons,
"Apple silicon" and "Intel", plus the hint "Apple menu > About This Mac".
Browser detection is unreliable, because Apple silicon reports Intel.

### 1.5 "macOS 13+" is not enforced [C]

`tauri.conf.json` has no `bundle.macOS.minimumSystemVersion`. **Fix:** set it
to `"13.0"`, or change the claim on the landing.

### 1.6 The panel can be clipped at the right screen edge [S]

`panel.rs:33` calls `move_window(Position::TrayBottomCenter)`, which does not
clamp to the screen. The panel is 340 px wide. **Fix:** use
`move_window_constrained`.

### 1.7 Landing metadata [C]

The landing has no `og:*`, `twitter:*`, canonical link or `robots.txt`. The
favicon and the template title are fixed in #33.

## Batch 2: process and security

### 2.1 CI never runs the Rust code [C]

`pr-validation.yml` runs only on ubuntu with bun. No workflow runs
`cargo test`, `cargo clippy` or `cargo fmt --check`. The kill guards in
`kill.rs` and `classify.rs` are only tested locally, and a broken desktop
build is found at release time. **Fix:** add a macOS job, path-filtered to
`apps/desktop/**`, that runs fmt, clippy with `-D warnings`, and test.
Optionally add `tauri build --debug --no-bundle` as a smoke test.

Untested today:

- `panel.rs`, `lib.rs` and `commands.rs`;
- the `kill_port_impl` branches after the static guard (start-time mismatch,
  other user, SIGKILL escalation).

Extract the toggle-and-blur decision into a pure function so it can be tested.

### 2.2 The `production` environment is unprotected [C]

`release-desktop.yml`, `release-web.yml` and `release-please.yml` declare
`environment: production`, which has no protection rules. With
`workflow_dispatch`, anyone with write access can run the signing job on any
branch, with the Developer ID certificate and the Apple key unlocked.

**Fix:**

- Require a reviewer, and restrict deployments to `main` and the release
  tags.
- Remove `workflow_dispatch` from the signing job, or guard it to `main`.
- Split `RELEASE_PLEASE_TOKEN` and the Cloudflare token into their own
  environments.
- Confirm the PAT is fine-grained, scoped to this repository, and has a short
  expiry.

### 2.3 Signing keychain unlocked while untrusted build code runs [C]

The keychain is unlocked for 6 hours (`-lut 21600`) while `tauri build` runs
npm and crate build scripts, and the `.p8` sits in `$RUNNER_TEMP`.

**Fix:**

- Build unsigned first, then sign and notarize in a step that runs only
  trusted tools.
- Delete the `.p8` after notarization.
- Shorten the keychain timeout.

### 2.4 Actions pinned to mutable tags [C]

Every `uses:` points at a tag, not a SHA, and `rust-toolchain@stable` floats.
Third-party actions run with secrets. **Fix:**

- Pin each action to a full SHA, with a version comment.
- Pin the Rust toolchain.
- Add Dependabot or Renovate for `github-actions`.

### 2.5 The kill policy lives only in the renderer [C]

`kill.rs` `static_guard` only refuses PIDs below 100 and its own PID. The
System, App and Dev categories are renderer-only friction (`classify.rs` says
so explicitly). Combined with `"csp": null` and the unused `opener:default`
permission, a future XSS could kill any same-user listener.

**Fix:**

- Refuse `System` in Rust, re-deriving the category from the live process.
- Set a real CSP: `default-src 'self'`, then check what styles need.
- Drop `opener:default` and `@tauri-apps/plugin-opener`, which are unused.

### 2.6 Kill result and PID reuse [C]

`kill.rs`:

- reports `Killed` right after SIGKILL without checking the process died;
- maps every SIGTERM error other than ESRCH to `PermissionDenied`;
- treats zombies as alive;
- does not re-check `start_time` before SIGKILL, so a PID reused inside the
  2 s window is possible, though unlikely on macOS;
- casts `pid as i32`, where `i32::try_from` would be safer.

**Fix:** re-validate before SIGKILL, then poll and report failure if the
process survives.

### 2.7 release-please and the GitHub Release step overlap [V]

release-please creates the GitHub Release. `release-desktop.yml` then runs
`softprops/action-gh-release` with `draft: true, prerelease: true` on the
same tag. As a result, `desktop: v0.1.0` is shown as **Pre-release**. Also,
`src-tauri/Cargo.toml` is not in release-please `extra-files`, so its version
drifts on the next bump.

**Fix:**

- Choose one owner for the GitHub Release. Either set `skip-github-release`,
  or have the workflow only upload assets.
- Add `Cargo.toml` to `extra-files`.

### 2.8 `.gitignore` gaps [C]

`.env.signing`, `.env.production`, `apps/*/.env`, `*.p12`, `*.p8` and `*.pem`
are not ignored. The git history is clean; this is prevention. **Fix:**
ignore `.env.*` but keep `!*.env.example`, and ignore the key files.

### 2.9 Release robustness [C]

- `download/latest/` is overwritten before the URL check runs. Verify the
  versioned path first, then publish `latest/`.
- The prune step does not guard against an empty `R2_BUCKET`.
- There is no DMG signature check (`spctl`, `stapler validate`) before upload.
- No checksums are published. Publish `SHA256SUMS` next to the DMGs.
- `cancel-in-progress: true` can cancel a notarization halfway. Use `false`
  for release jobs.
- No `cargo audit` or `bun audit` runs anywhere.

### 2.10 Landing security headers [C]

There is no `public/_headers`. **Fix:** add a CSP with
`frame-ancestors 'none'`, `X-Content-Type-Options` and `Referrer-Policy`.

### 2.11 Smaller desktop issues

- **[S]** Polling may keep running while the panel is hidden. It relies on
  `document.visibilityState` inside a hidden NSWindow. Drive it from panel
  visibility instead, and measure CPU use.
- **[C]** The 250 ms blur guard in `panel.rs` is a timing heuristic. Snapshot
  "was visible" on mouse-down instead.
- **[S]** There is no dismiss fallback if `set_focus` fails.
- **[C]** `tildify` in `project.rs:32` does not check the path boundary:
  `/Users/cx` becomes `~x`.
- **[C]** On the Listening tab, kill stays enabled while the data is stale.
- **[C]** There is no pending state during the kill's 2 s wait.
- **[C]** The favourite-name comment says 80 characters, but
  `MAX_NAME_LENGTH` is 30.

## Batch 3: architecture and documentation

### 3.1 The TS hexagon models the template, not chapay [C]

`domain` and `application` contain only the Todo example. The real domain
(ports, kill guards, categories) lives in Rust and `apps/desktop/src/lib`, and
the desktop imports no `@port-watcher/*` runtime package. The release
workflows still build every package. The recommendation is to cut the
packages back, or at least describe the real architecture honestly: a Rust
core, a thin renderer, and a landing.

The owner kept these packages on purpose in #27, so this needs a decision,
not a cleanup.

If the packages stay:

- generate the IPC types from Rust (`ts-rs` or `tauri-specta`) instead of
  mirroring `types.ts` and `models.rs` by hand;
- wire `tokens.desktop.css` into the desktop, or stop claiming the desktop
  will use it.

### 3.2 Stale or wrong documentation [C]

- **Root files:**
  - `README.md` onboarding fails today: it copies `.env` and runs `db:push`,
    but the DB is disabled and `dotenvx` is not installed. Use
    `bun run setup` instead.
  - The `description` in the root `package.json` is the template's.
- **CLAUDE.md** describes auth, server functions and `fullstackServerEnvSchema`
  as live. It still calls the desktop "in progress".
- **`apps/desktop/README.md`** and the docs pages `desktop/index.mdx`,
  `ui-development.mdx` and `debugging.mdx` contain:
  - a `dev` script instead of `vite:dev`;
  - a 360×480 window instead of 340×440;
  - a "Status" section about a `greet` demo;
  - `window-vibrancy`, which is not a dependency.
- **Docs site pages:**
  - `index.mdx`, `authentication.mdx` and `environment-variables.mdx`
    present auth and Postgres as live;
  - `backlog/index.mdx` lists shipped features as "Proposed".
- **ADRs:**
  - ADR 0001 says "not implemented", but it is;
  - ADR 0003 has the old status, the "seeded at 0.0.0" line, and a "download
    page" non-goal that exists;
  - ADR 0004 still lists the auth secrets in its Decision and Consequences.
- **`.claude/`:** `briefings.md` says "nothing published", and
  `architecture.md` mentions Neon.
- **Template leftovers:**
  - `apps/documentation/README.md` is the Starlight starter;
  - `packages/infra-db/SPEC.md` uses a `monorepo_template` prefix;
  - the `packages/domain` README tree is wrong.

### 3.3 Missing documentation [C]

- A user-facing install guide:
  - drag the app to Applications;
  - the arm64 versus x64 choice;
  - notarization and the "downloaded from the Internet" prompt.
- Permissions: what chapay can see and kill, which is only your own
  processes, and why it may ask for Documents access (until 1.2 is fixed).
- How to use the app:
  - the tray click and ⌥⌘P;
  - search;
  - the two-step kill;
  - favourites;
  - quitting with a right click.
- A README for `apps/fullstack-fn-only` (the landing,
  `VITE_PUBLIC_DOWNLOAD_URL`, the dormant auth and how to re-enable it).
- An ADR for disabling auth and the DB, which today is only an amendment
  inside ADR 0004.

### 3.4 Plans and specs location rule [C]

- Delete the shipped plans under `docs/superpowers/plans/` (Rust core,
  renderer, menu-bar shell, `native-overlay/` F6 and F7) once their status is
  confirmed.
- Move `docs/superpowers/specs/2026-09-16-panel-ui-stylex-design.md` to
  `docs/specs/`.
- Fix the links that break: ADR 0001 and ADR 0002, and the `lib.rs:16`
  comment.
- Point `.claude/skills/plan-to-backlog` at `docs/plans`.

### 3.5 Repository hygiene

- Remove the empty `.worktrees/feat` directory.
- Prune the merged local branches.
- Remove `.claude/commands` and skills that write to a `features/` docs
  folder that does not exist, or create that folder.

### 3.6 Later, when there are users beyond the owner

- An auto-updater: `tauri-plugin-updater` with a signed `latest.json` on R2.
  A cheaper stopgap first: show the running version in the panel and compare
  it with a `latest/version.json` file.
- Launch at login (`tauri-plugin-autostart`).
- A first-run hint, so users can find the menu-bar icon and ⌥⌘P.
- The bundle id decision (see Open questions).

## Out of scope

- A custom download domain. The owner chose to keep the R2 `pub-…r2.dev`
  URL.
- Anything already fixed in PR #33.
