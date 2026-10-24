# ADR 0008: one app, two bounded contexts — Ports and System health

**Status:** Accepted by the owner (2026-10-24). Not implemented: the work runs in phases on
`feat/chapay-v2` (issue #55); nothing of it is on `main`.
**Date:** 2026-10-24.
**Spec:** [docs/specs/2026-10-24-chapay-v2-design.md](../specs/2026-10-24-chapay-v2-design.md).

## Context

chapay lists listening ports and kills the process behind one. The owner's laptop overheats when a
local LLM runs, and Activity Monitor answers neither "should I worry?" nor "which process do I stop?".
The v2 design adds a **Machine** mode (CPU, GPU, heat, memory, thermal pressure, top processes with
kill) next to **Ports**. Two shapes were possible: a second app, or a second mode in chapay.

The hub's guidance ([bounded contexts](https://github.com/csdev19/general-knowledge/blob/main/architecture/bounded-contexts-complete-guide.md),
[MVP first](https://github.com/csdev19/general-knowledge/blob/main/conventions/mvp-first-then-refactor.md))
says a context is a boundary of language and rules, and that layers are extracted once a second
consumer exists.

## Decision

- **One app.** Machine is a second tab in the same panel and the same release pipeline (signing,
  notarization, release-please, updater). Both modes end in the same action — kill the right process
  safely — and the kill flow already exists (ADR 0006).
- **Two bounded contexts:**
  - **Ports** — listener, `PortEntry`, label, project, category, favourite, kill guard. Unchanged.
  - **System health** — `Sample`, `Sensor`, `Threshold`, `Verdict` (OK / WATCH / STOP), `Attribution`
    (which process drives a metric). CPU, GPU, heat and memory are **modules inside** this context,
    not separate contexts: the verdict needs them together (fan high with CPU idle is one rule).
- **No shared kernel.** The contexts meet only in the app layer: the full window's "Ports" column on a
  process row joins by PID + start time in the desktop app. Process signalling is an operating-system
  adapter in the desktop crate, used by both contexts; it is not a domain model.
- **Product rule:** System health only shows what leads to an action on a process. Charts for their
  own sake, network, disk and fan control stay out.

## Alternatives rejected

- **A second app.** Duplicates the signing, notarization, R2, updater and release pipeline, and the
  kill flow, for the same user in the same moment.
- **One context per metric** (CPU, Temperature, Memory, Fan). The verdict crosses metrics, so a fifth
  context would be needed to combine them.
- **A shared `Process` kernel now.** Only speculative reuse today; revisit when Attribution and Ports
  share more than PID signalling.

## Consequences

- Copy, docs and the landing describe chapay as watching ports and the machine. The v1 voice rule
  "never say it monitors" is retired for the Machine mode.
- Every Machine feature must pass the product rule above.
- The renderer gains a top-level tab bar (Ports | Machine); Ports loses about one visible row.

## Non-goals

General-purpose system monitoring (network, disk, Bluetooth), fan control, Windows and Linux.

## Reopen when

- A Machine feature is wanted that does not lead to an action on a process, or
- the two contexts start sharing domain rules beyond PID signalling, or
- the Machine mode needs a release cadence or distribution different from Ports.
