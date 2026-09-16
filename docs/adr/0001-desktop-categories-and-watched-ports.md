# ADR 0001: desktop classification and watched-port boundaries

**Status:** proposed for implementation; not implemented on this branch.
**Date:** 2026-09-16.
**Integration dependencies:** F6 introduces classification and shared confirmation;
F7 consumes those contracts. Product scope comes from the original audit; the detailed
defaults below were developed during the implementation-plan review.

## Context

The Rust core owns process metadata and kill guards. React receives snapshots and owns
interaction state. Categories require executable paths absent from today's IPC model.
A favourite persists a port number across process restarts, whereas a live kill targets
PID, port and start time. Several PIDs can share one port.

## Decision

- Classify in a pure Rust function using UID and executable path, then serialize category,
  executable path and outermost app bundle path alongside the existing fields.
- Classification changes grouping and confirmation UX, not backend authorization.
  Unknown ownership groups as system and remains unkillable through existing ownership rules.
- Keep one confirmation owner in the renderer for pointer and keyboard entry points.
  Confirmation identity includes `pid`, `port`, `startedAt`; navigation may retain `pid:port`.
- Persist only `{ port, name? }[]` under `chapay.favourites`. Derive all process metadata
  from the shared `usePorts` snapshot. One watched port joins all matching live rows.
- Keep the implementation within the desktop app, using small pure helpers and React hooks.
  Apply the [MVP-first guidance](https://github.com/csdev19/general-knowledge/blob/main/conventions/mvp-first-then-refactor.md)
  rather than creating cross-package abstractions for a single consumer.

## Alternatives rejected

- Renderer classification from command text: quoted commands and arguments do not reliably
  identify the executable; owner UID is not present in the renderer.
- Persisting PID or an entire PortEntry: stale process metadata can target a different incarnation.
- Joining with `find(port)`: silently loses other processes sharing a port.
- A separate confirmation hook per row plus a keyboard-only confirmation: inconsistent armed
  state, expiry and invalidation across two paths.
- Tauri store or database: adds a persistence boundary unnecessary for this local manual list.

## Consequences

Rust and TS fields and all fixtures must change together. Path classification is heuristic;
same-user command-line daemons outside system prefixes may appear as dev. Browser preview
and packaged app have separate storage origins. Favourites cannot claim availability until
a successful snapshot exists. Shared confirmation slightly expands App orchestration but
prevents bypasses and can be reused by both tabs.

## Explicit non-goals

No process trust/security taxonomy, privileged kill, bulk kill, executable verification,
network probing, port reservation, notifications, synchronisation, label-rule rewrite,
generic table framework or cross-platform classification design.

## Reopen this decision when

Another consumer needs classification; unknown-path misclassification becomes a documented
product problem; favourites need sync/migration across origins; or users need to distinguish
interfaces/protocols rather than a machine-local TCP port number.

## Operational contract

Field definitions, state transitions, tests and usage live separately in the
[F6](../superpowers/plans/native-overlay/f6-port-categories.md) and
[F7](../superpowers/plans/native-overlay/f7-favourites.md) implementation plans.
