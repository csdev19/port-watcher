# ADR 0012: for a process chapay may not kill, show the command; never run it with privileges

**Status:** accepted (2026-11-07); implemented on branch `feat/memory-guard`, not on `main` until
that PR merges.
**Date:** 2026-11-07.
**Spec:** [docs/specs/2026-11-07-memory-guard-design.md](../specs/2026-11-07-memory-guard-design.md).
**Relation to [ADR 0006](0006-kill-policy-enforced-in-rust.md):** extends it. 0006's first reopen
condition ("users have a legitimate need to stop a system or other-user listener and a safe
privileged design exists") is half met: the need is proven by the evidence of 2026-11-06; a safe
privileged design is not chosen. This ADR records the choice to stop at showing the command.

## Context

The process that filled the swap was a root launchd daemon. Quitting its menu-bar app from the UI
did nothing (the daemon kept its PID and its 16 GB); `sudo launchctl kickstart -k system/<label>`
freed the memory in seconds. The owner wants chapay to name the process and tell them how to free
it, and does not want the app to be "invasive".

macOS offers two ways for an app to act as root: a one-shot `osascript … with administrator
privileges` (simple, not cancellable, leaves a root child if interrupted) and a persistent helper
registered through `SMAppService` (approved once in System Settings, outlives the app, must be
versioned and signed separately). Both put a root execution path inside a menu-bar utility.

## Decision

- When `is_killable` refuses a process (another user, root, a system path), the Memory tab shows a
  command card instead of a Kill button:
  - `sudo launchctl kickstart -k system/<label>` when `<label>` is found by matching the process's
    executable path against `Program` / `ProgramArguments[0]` of the plists in
    `/Library/LaunchDaemons`;
  - otherwise `sudo kill <pid>`, with the note "launchd restarts it if it is a service".
- The card has a Copy button and one line of context ("runs as root; chapay cannot stop it"). When the
  executable path is under a known endpoint-security vendor's directory (Zscaler, CrowdStrike, Avira,
  SentinelOne), the line adds "managed security software: check your IT policy". It informs; it does
  not block.
- chapay never spawns `sudo`, `osascript` or a helper. The kill policy of ADR 0006 is unchanged.

## Alternatives rejected

- **osascript one-shot elevation.** A root execution path driven by a string built in the app; a bug
  in the label lookup becomes an arbitrary root command. Apple's own guidance calls it a last resort.
- **SMAppService helper with a closed API (`restart_service(label)`).** The safe design 0006 asks for,
  but weeks of infrastructure (signing, approval flow, version skew) for an action the owner needs
  about once a week.
- **Showing nothing for non-killable rows.** The name is half the value; the command is the other half.

## Consequences

- The owner pastes one line into Terminal for root daemons. Measured today: five seconds.
- The label lookup reads plists on demand (when a card is rendered), not on every tick.
- A wrong label would print a command that fails harmlessly ("Could not find service"); it cannot
  stop the wrong daemon because launchd labels are unique.

## Non-goals

- Running, scheduling or remembering any privileged command.
- Killing other users' processes.

## What would reopen this

- The owner needs the restart more than weekly, or a second user asks for it; then the SMAppService
  helper with a closed API is the design to write, and ADR 0006's reopen condition is fully met.
- Apple ships a sanctioned one-shot privileged API for non-sandboxed apps.
