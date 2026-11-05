# ADR 0014: verify release candidates, not every pull request

**Status:** Accepted (2026-11-05). Implemented on branch `ci/release-gated-verification`; not on
`main` until that branch merges. No release PR or tag has run the new workflows yet. Amends the
"Checks that run before a release" part of [ADR 0003](0003-release-please-and-desktop-distribution.md)'s
pipeline; the release steps of ADR 0003 and [ADR 0007](0007-desktop-updates-through-tauri-updater.md)
are unchanged, they only wait for a gate now.
**Date:** 2026-11-05.

## Context

Until now every pull request to `main` ran `pr-validation.yml` (install, lint, format, package
builds, types, tests, web build), every PR or push touching `apps/desktop/` ran `desktop-ci.yml`
on macOS, and lockfile PRs ran `security-audit.yml`. release-please ran on every push to `main`.
Meanwhile `release-desktop.yml` and `release-web.yml` published with no verification job at all:
a tag built, signed, uploaded and moved the update feed from a commit nothing had checked on
that SHA.

chapay has one owner, `main` has no branch protection
(`gh api repos/csdev19/port-watcher/branches/main/protection` returns 404), and agents push on
the owner's behalf. PR-time checks here are advisory: nothing requires them, and they bill every
push, macOS at about ten times Linux.

The reusable rules are in the hub:
[release-gated-verification](https://github.com/csdev19/general-knowledge/blob/main/monorepos/release-gated-verification.md)
(rules R1–R8, the tier table, "Pick the tier by who merges") and the draft/ready trigger in
[pr-checks](https://github.com/csdev19/general-knowledge/blob/main/monorepos/pr-checks.md#draft--ready-for-review-as-the-trigger).
The reference implementation is kaipu's `pr-checks.yml`. This ADR records how chapay applies
them; it does not repeat their reasoning.

## Decision

- **One definition of verified.** Root scripts `verify` (lint, `oxfmt --check .`,
  `build --filter='@port-watcher/*'`, `check-types`, `test`) and `verify:rust` (renderer build,
  then in `apps/desktop/src-tauri`: `cargo fmt --check`, `cargo clippy -D warnings`,
  `cargo test --locked`). Hooks and workflows call these, never their own list.
  `verify:rust` builds the renderer first because `tauri::generate_context!` embeds
  `apps/desktop/dist`, which a fresh clone does not have.
- **Local push tier.** Lefthook `pre-push` runs `bun run verify` on every push and
  `bun run verify:rust` only when the pushed files match `apps/desktop/src-tauri/**` (Lefthook's
  `glob`, applied to the push files). Measured on the owner's M5 Pro, 2026-11-05:

  | Script        | Cold (no Turbo / cargo cache) | Warm      |
  | ------------- | ----------------------------- | --------- |
  | `verify`      | 27.0 s                        | 4.3–4.7 s |
  | `verify:rust` | 102.8 s                       | 4.0–10 s  |

  Both are well under a minute warm, so by R4 every check belongs in the hook. Checked against
  Lefthook 2.1.12 in a scratch repository: the Rust job is skipped on a docs-only push (new
  branch or existing upstream) and runs when the push carries a `src-tauri` change. Without a
  local `origin/HEAD` a new branch is compared more widely and the Rust job runs, which fails
  safe.

- **Ordinary PRs: one quick check.** `pr-checks.yml` replaces `pr-validation.yml`. Every
  non-draft PR gets **Quick checks** (install, lint, format check: a backstop for a push made
  with the hook bypassed). No `branches:` filter, no `edited`, no `labeled`; eligibility at job
  level; concurrency per job keyed by PR number, as in the hub's shape.
- **Release candidates: full verification.** A `classify` job (no checkout) marks a candidate
  when the head branch starts with `release-please--branches--` or the run is a manual dispatch.
  Candidates then call `verify.yml` (Linux), `desktop-ci.yml` (macOS) and `security-audit.yml`
  (`cargo audit` fails, `bun audit` reports). release-please opens its PRs as drafts
  (`draft-pull-request: true`); marking one **Ready for review** starts the run, every later
  revision is re-verified, and converting it back to draft cancels in-flight runs.
- **Release gate.** `release-desktop.yml`'s build/sign/publish job `needs:` `verify.yml` and
  `desktop-ci.yml`; `release-web.yml`'s deploy `needs:` `verify.yml`. They run on the tagged
  SHA, which is the merge commit, not the PR head the candidate run checked. No verify job
  receives secrets or the `production` environment.
- **release-please is path-filtered** to the paths that can change a release PR
  (`apps/desktop/**`, `apps/fullstack-fn-only/**`, `packages/**`, `bun.lock`, the config, the
  manifest, its own workflow) and gains `workflow_dispatch` for catch-up.
- **No required check and no "Merge requirements" gate job.** With one merger and no
  protection, the gate would be a status icon billed per PR (hub: "One owner, agents pushing on
  their behalf" → hook + candidate).

## Alternatives rejected

- **Keep full verification on every PR.** It bills Linux and macOS minutes for checks the hook
  already ran in seconds, while the release workflows, the only place a bad commit reaches
  users, stayed ungated.
- **No PR-time cloud check at all.** The hub allows it for this row. The owner asked for
  lightened checks, not none, and a seconds-long lint/format job catches a `LEFTHOOK=0` push for
  about a billed minute.
- **A required gate job with classify-and-pass**, as kaipu has. Correct once a check is
  required; without branch protection nothing reads it.
- **A `verify` label as the candidate trigger.** release-please's own `autorelease: *` labels
  would start runs (measured on kaipu; see the hub page).
- **Rust on Linux to save minutes.** The crate's port and process code is macOS-specific, so a
  Linux run would compile and test a different program (R7).

## Consequences

- An ordinary PR now shows one check, **Quick checks (lint, format)**, and a draft PR shows
  none. The full suite and the macOS run appear only on a ready release PR or a manual dispatch.
- A regression the hook did not catch (clean-environment issues: a stale lockfile, a missing
  file, an unpinned tool) surfaces on the release PR, possibly several merges after its cause.
  After a risky merge (lockfile, workflows, `scripts/`, build config), dispatch **PR checks**,
  **Verify** or **Desktop CI** by hand.
- `main` can be red between releases. Nothing ships from it until a tag passes the gate.
- A release costs the verification twice (on the ready PR and on the tag), including two macOS
  runs for desktop. That is the price of R1 on the tagged SHA.
- Lockfile PRs (including Dependabot's) no longer run `cargo audit`; the weekly schedule, the
  release PR and manual dispatch do.
- The release PR must be marked ready by hand. Forgetting is not dangerous: the tag's gate fails
  before anything is signed or uploaded, at the cost of a burnt version number.
- The hook makes every push take about 5 s (plus 4–10 s for Rust pushes) warm, and up to about
  2 minutes on a cold cargo cache.

## Non-goals

- Making any check required, or turning on branch protection.
- Caching Turbo outputs in Actions, or splitting `verify` into parallel jobs (kaipu does; at 27 s
  cold here it is not worth the complexity).
- `cargo audit` in the release gate. It stays on the candidate and the schedule, so a new
  advisory against an unchanged lockfile cannot block an urgent release by itself.
- A platform E2E. chapay has none yet; when one exists it runs on the ready desktop candidate
  and again at the tag (R7).
- Archiving a billing export before and after the change (R8); the owner has not pulled one.

## Reopen when

- Branch protection or a ruleset requires a check, or a second person merges regularly: add the
  hub's classify-and-pass **Merge requirements** gate and make it required, or move `verify` to
  every non-draft PR.
- Outside contributors' PRs are accepted (strangers do not run the hook).
- Warm `verify` grows past a minute on the owner's machine: move its slowest part out of the
  hook into the candidate tier.
- A release PR fails on a regression that takes more than one bisect to place: dispatch
  verification after every risky merge, or run `verify.yml` on pushes to `main`.
