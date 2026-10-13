# ADR 0006: the kill policy is enforced in the Rust core, not only in the panel

**Status:** accepted; implemented on `main` by PR #38 (commit `9de9d24`, 2026-10-13). Not in the
released `desktop-v0.1.0`; it ships with the next desktop release.
**Date:** 2026-10-13.
**Amends:** [ADR 0001](0001-desktop-categories-and-watched-ports.md), whose decision said that
classification "changes grouping and confirmation UX, not backend authorization". That sentence no
longer holds for the `system` category.
**Sources:** the PR #38 description and the body of commit `9de9d24` (post-0.1.0 audit item
NIW2-345, items 2.5 and 2.6). The reasoning below is theirs; nothing here is inferred beyond what is
marked.

## Context

In `0.1.0` the Rust core decided only whether a kill was _possible_: the PID still listens on that
port, the start time matches, the process belongs to the current user, the PID is not below 100 and
not chapay itself. The three categories (`dev`, `app`, `system`) existed, but only the renderer used
them, to group rows and to choose how much confirmation to ask for. A same-user process under
`/System`, `/usr/libexec` or `/usr/sbin` could therefore be killed from the panel.

The panel also ran with `"csp": null`. With no content security policy, a future cross-site
scripting bug in the renderer could call `kill_port` for any same-user listener, and the Rust side
would have accepted it.

The escalation had two smaller defects: it reported `Killed` right after `SIGKILL` without checking
that the process died, and a PID reused inside the two-second `SIGTERM` window could receive
`SIGKILL`.

## Decision

- The Rust core owns the kill policy. `kill_port` re-derives the category from the live process
  (owner UID and executable path, `classify_port`) and returns `PermissionDenied` for `system`
  listeners, whatever the request said. A system listener is one owned by another user, one with
  an unknown owner, or one whose executable is under `/System`, `/usr/libexec` or `/usr/sbin`.
- The list and the kill share one function, `is_killable` (`ports/kill.rs`). The panel's lock icon
  and the `killable` flag mirror the core's policy instead of restating it.
- `app` and `dev` listeners stay killable. Their extra friction (two-step confirmation) stays in
  the renderer, because it is a usability measure, not a security boundary.
- Escalation is stricter: the target is re-validated (start time, zombie) on every poll; after
  `SIGKILL` the core polls for one second and returns an error if the process survived; `EPERM`,
  `ESRCH` and other errno values map to distinct results; zombies count as gone.
- The panel gets a real CSP in `tauri.conf.json` (`default-src 'self'`, no inline scripts or
  styles in production) so a renderer compromise is harder to start.
- The OS calls sit behind a `ProcessOps` trait, so every guard and escalation branch has a unit
  test without real processes. Desktop CI runs those tests on macOS (`desktop-ci.yml`).

## Alternatives rejected

- **Keep the policy in the renderer and rely on the CSP.** This was the state in `0.1.0`. A single
  renderer bug, or a future XSS, would bypass the only check. The CSP reduces the chance but is not
  a substitute for a check on the side that sends the signal.
- **Trust the category sent with the request.** The renderer could claim `dev` for any process. The
  core classifies from the live process instead.

## Consequences

- chapay can no longer kill system services or other users' processes, even if a user wants to.
  The panel shows a lock on those rows.
- A kill that does not take effect now reports an error ("Could not kill ...") instead of a silent
  success.
- Rust and TypeScript must keep the same idea of `killable`. The Rust function is the source; the
  TypeScript type documents that the core also refuses `system`.
- The classification is path-based and heuristic (ADR 0001). A system-like daemon outside the three
  prefixes is still classified `app` or `dev` and stays killable.
- One second after `SIGKILL` may be too short for a heavy process (Docker, a JVM) and could report a
  false failure. The PR flagged this for the owner to judge; it has not been measured.
- The workflow and CSP changes in the same PR had not run on GitHub or in a packaged app when it
  merged. Whether the production CSP leaves the panel fully styled is verified only by running a
  built app.

## Explicit non-goals

- A privileged kill path (`sudo`, an XPC helper) for system processes. ADR 0001 already lists it as
  a non-goal.
- Bulk kill, process trust scoring, or an allowlist of protected process names.
- Moving grouping or confirmation friction into Rust.

## Reopen this decision when

- Users have a legitimate need to stop a system or other-user listener and a safe privileged
  design exists.
- The one-second post-`SIGKILL` window produces false failures in practice.
- Classification by path proves too coarse and a process that should be protected is shown as `dev`
  or `app`.
