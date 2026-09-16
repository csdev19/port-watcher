# Native overlay and watched ports — execution index

**Status:** implementation plans, not implemented. Reviewed against branch
`docs/native-overlay-audit-and-roadmap`, implementation baseline `b601d91`, 2026-09-16.
**Planning model:** GPT-6 Astra, explicitly selected by the user.
**Source:** [original audit](../2026-09-16-native-overlay-audit.md).

## Analysis: what needed correction

| Item            | Repository evidence                                                                                           | Consequence for execution                                                                                                                               |
| --------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1              | `lib.rs` sets a tray tooltip. The historical report describes a screenshot; this review did not reproduce it. | Removing the tooltip is justified; “confirmed root cause of all flicker” is not. Record before/after native results.                                    |
| F2              | Tray uses the bundle icon; Cargo does not explicitly enable PNG decoding.                                     | Asset creation, decoder feature, actual image scale and native appearance are separate acceptance checks. Merely adding an `@2x` file does not wire it. |
| F3–F5           | Input suppression, production context-menu suppression and selection rules are absent.                        | These are preventive hardening, not experimentally confirmed flicker causes. Selectable command text intentionally retains some native interactions.    |
| F6 classifier   | Enrichment requests cmd/cwd/user but not executable path; IPC carries no executable or bundle path.           | Add executable refresh and explicit nullable path fields. Do not parse the command string as an executable path.                                        |
| F6 kill         | Mouse already confirms all killable rows. `App.tsx` bypasses that hook for `⌘⌫`.                              | New protection must cover keyboard and mouse; styling alone is insufficient.                                                                            |
| F6 grouping     | Navigation receives all filtered entries; reopening currently only refetches and focuses.                     | Navigation must receive only visible rows; define panel-open resets and search precedence.                                                              |
| F7 join         | `source::dedupe` deliberately preserves different PIDs sharing one port.                                      | A watched port joins zero-to-many listeners; never choose an arbitrary PID or kill by saved port alone.                                                 |
| F7 availability | Query can have no data or stale data after failure.                                                           | “Free” requires a successful snapshot. Missing data is unknown, not free.                                                                               |

No native reproduction or implementation tests were run for this documentation review.
The screenshot and mockups 3b/4a/4b are historical references, not assets attached to these plans.
Use the written interaction contracts and existing CSS; pixel-identical mockup implementation
requires the original mockups. F2 still needs a reviewed tray artwork.

## Documents and dependencies

| Order | Document                                         | Scope / suggested branch       | Prerequisite                         |
| ----- | ------------------------------------------------ | ------------------------------ | ------------------------------------ |
| 1     | [F1 — tray tooltip](f1-tray-tooltip.md)          | `fix/tray-tooltip-flicker`     | Current baseline                     |
| 2a    | [F3 — search assistance](f3-search-input.md)     | `fix/native-overlay-hardening` | F1 recommended for native comparison |
| 2b    | [F4 — renderer context menu](f4-context-menu.md) | Same branch as F3              | F3                                   |
| 2c    | [F5 — text selection](f5-text-selection.md)      | Same branch as F3              | F4                                   |
| 3     | [F2 — template icon](f2-tray-template-icon.md)   | `feat/tray-template-icon`      | Reviewed asset; integrate F1 first   |
| 4     | [F6 — categories](f6-port-categories.md)         | `feat/port-categories`         | Hardening integrated                 |
| 5     | [F7 — favourites](f7-favourites.md)              | `feat/favourites-tab`          | F6 implemented and verified          |

Execute serially: F1/F2 share Rust setup; F3–F7 share renderer files. F2's asset
review need not block F6/F7. Branch/PR names are suggestions, not instructions to commit
or publish without user authorization.

## Defaults specified by this expansion

The source approved categories and favourites, but did not specify every edge case.
These are **proposed implementation defaults**, not claims of separate user approval:

- Unknown owner is grouped as system; unknown executable with known same-user ownership
  falls through to dev. Backend `killable` remains independent.
- Protected keyboard kill uses the same two-second confirmation state as clicking.
- Successful snapshots count listener rows in Listening; favourites count unique watched ports.
- Duplicate watched ports are a validation error, saved order is insertion order, and one
  watched port can show multiple live process rows.
- Failed initial polling is unknown; stale snapshots are labelled stale and disable favourite kill.
- Saved names label the watch, without overwriting the live process label.
- Panel open clears search, detail expansion, pending confirmation and transient form state,
  selects Listening and collapses Apps & System. This deliberately extends today's reopen behavior.

The structural rationale and reopening conditions are in
[ADR 0001](../../../adr/0001-desktop-categories-and-watched-ports.md).
If a default is changed, update its task and dependent acceptance tests before implementation.

## Runner contract

1. Read this index, the selected task, `CLAUDE.md`, and any directory-specific instructions.
2. Inspect the named existing symbols; paths in tasks are relative to the repository root
   unless introduced as relative to `apps/desktop`. Proposed files are explicitly called new.
3. Verify dependencies by reading actual code, not by assuming earlier plans were executed.
4. Implement one task or one numbered F6/F7 slice at a time. Keep a working build after each slice.
5. Preserve the Rust/TS mirror, process-incarnation kill checks, two-second visible polling,
   transparent shell behavior, and CSS-only tooltips.
6. Use existing dependencies. No shared package extraction, new state framework, persistence
   plugin, native dialog, `title`, or unrelated shell rewrite is required.
7. Run the task checks. Report exact commands, results, native checks actually performed,
   and remaining blockers. Do not label native appearance verified by jsdom.

Suggested prompt for a smaller model:

> Implement F6 slice 1 from `docs/superpowers/plans/native-overlay/f6-port-categories.md`.
> Read its execution index and prerequisites first. Follow the specified contracts and tests;
> do not implement later slices. Report any repository drift before changing the plan.
> Run the slice checks and report results. Do not commit or open a PR.

## Commands

Run renderer commands with working directory `apps/desktop`:

```sh
bun run test
bun run check-types
bun run build
```

Run Rust commands from the repository root:

```sh
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --check
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
```

Native dev: `bun run dev:desktop` from root. Release acceptance: `bun run build:desktop`
from root, then launch the built app. `desktop`'s `build` alone only builds Vite.
Existing Rust tests include local OS enumeration and terminating an owned `sleep` child;
they require a suitable macOS host. Do not run real kill acceptance against system apps.

## Completion evidence

For each task record: implementation commit if any, automated checks with exit status,
macOS version and display scale for native checks, before/after observations, and gaps.
F1–F5 may use manual acceptance rather than tests that merely mirror attributes/CSS.
F6/F7 require behavioral regression tests because they alter target selection and persistence.
