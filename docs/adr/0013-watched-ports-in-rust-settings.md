# ADR 0013: watched ports live in `settings.json`, readable from Rust

**Status:** Accepted by the owner (2026-10-24). Implemented in Phase 5 on `feat/chapay-v2`; not on
`main` until that branch merges.
Amends the persistence decision of [ADR 0001](0001-desktop-categories-and-watched-ports.md)
("Persist only `{ port, name? }[]` under `chapay.favourites`" and the rejected "Tauri store").
**Date:** 2026-10-24.
**Spec:** [docs/specs/2026-10-24-chapay-v2-design.md](../specs/2026-10-24-chapay-v2-design.md).

## Context

ADR 0001 kept the watched ports in the renderer's `localStorage` because the only consumer was the
panel's own join against the live snapshot. [ADR 0011](0011-event-driven-background-signals-and-alerts.md)
adds a second consumer: the "watched port taken" alert runs in Rust, with the panel closed, and
needs the list. A Rust process cannot read a webview's `localStorage`. ADR 0001 named this case in
its reopen clause ("another consumer").

## Decision

- The list is stored in `settings.json` (the existing `tauri-plugin-store` file) under the key
  `favourites`, with the same record shape `{ port, name? }[]`. The renderer reads and writes it
  through the settings store, so the panel and the Settings window share it through the store's
  `store://change` event; the DOM `storage` event sync is gone. Rust reads the key at every scan
  of the alert engine (an in-memory store read).
- **One-time import.** The first time a window runs the new version and `settings.json` has no
  `favourites` key, it copies the sanitized `localStorage["chapay.favourites"]` list into the store.
  Any value in the store, including an empty list, means the import already happened. The key is not
  written as a store default, because a default would hide its absence.
- **The old `localStorage` key is never deleted by this release.** It is the rollback path: an
  older build still reads it. A later release may remove it.
- Validation stays in the renderer (`sanitizeFavourites`, port range, name length); Rust reads
  leniently and ignores anything malformed.
- Edits show on screen at once and save in the background; a failed save puts the previous list back
  and reports it.

## Alternatives rejected

- **Keep `localStorage` and mirror it to Rust through a command.** Two sources of truth, and Rust is
  blind until the panel's webview has run and pushed the list; the alert would not work after a
  restart with the panel closed.
- **A Rust-owned list behind new commands (`add`, `remove`, `rename`).** A larger IPC surface for the
  same data, and it duplicates the validation the renderer already owns.
- **Delete the old key after importing.** Saves a few bytes and makes the release irreversible.

## Consequences

- A user who downgrades to an older build sees the list as it was at upgrade time, not later edits.
- The browser dev loop and tests keep the settings in memory, so the list does not persist there.
- The first frame after the upgrade shows an empty list until the import finishes (a few
  milliseconds); later launches use the settings warm cache.
- Two windows importing at the same moment both write the same sanitized list.

## Non-goals

Syncing across machines, versioning the list, importing from anywhere other than `localStorage`,
and moving any other renderer state into the store.

## Reopen when

A later release removes the old `localStorage` key; the list needs to be shared with a second
process or synced across machines; or the store file becomes a measurable cost (the list grows
beyond a few dozen ports).
