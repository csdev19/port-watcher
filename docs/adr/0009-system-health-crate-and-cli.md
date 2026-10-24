# ADR 0009: System health lives in its own Rust crate, with a CLI

**Status:** Accepted by the owner (2026-10-24). Not implemented: Phase 2 on `feat/chapay-v2`
(issue #55). The spike it starts from is `examples/thermal-probe`.
**Date:** 2026-10-24.
**Spec:** [docs/specs/2026-10-24-chapay-v2-design.md](../specs/2026-10-24-chapay-v2-design.md).

## Context

The desktop crate (`apps/desktop/src-tauri`, crate `port-watcher`) holds all Rust today. System
health ([ADR 0008](0008-one-app-two-bounded-contexts.md)) has two consumers from day one: a CLI for
measuring from the terminal, and the desktop app. Ports has one consumer. The repo has no Cargo
workspace; release-please computes the desktop version from commits under `apps/desktop` only.

## Decision

- Create **`crates/system-health`**: a library with a pure `domain/` (sensor classification incl. the
  power-gated `Tp*` 40.0 °C floor, verdict, thresholds, attribution) behind a `Sources` trait, macOS
  adapters in `infra/`, and a **`chapay` CLI binary** (`heat`, `top`, `sensors`; human, `--json`,
  `--csv`, `--watch`). The CSV keeps the spike's columns first so `hot-capture.sh` keeps working.
- The desktop crate depends on it **by path**. No root Cargo workspace until a second shared crate
  appears.
- **Ports stays in the desktop crate.** `chapay ports` is reserved but deferred; extracting Ports waits
  for a real second consumer.
- **Releases:** a change only under `crates/system-health` does not move the desktop version by itself.
  Such changes ship with the next desktop release; a crate-only fix that must ship alone gets a
  `fix(desktop): …` commit touching `apps/desktop` (e.g. the dependency line). Revisit if this bites.
- CI runs the crate's pure tests on Linux; macOS-only adapters are compiled and tested in the existing
  macOS desktop job.

## Alternatives rejected

- **A module inside the desktop crate.** The CLI would compile Tauri, and the context boundary would
  be a convention only.
- **A workspace with a crate per context now.** Moves working Ports code with one consumer — work
  without benefit today.
- **The `macmon` crate as the source.** Gives averages instead of the hotspot and a private API surface
  we do not control; kept as a fallback, mainly for IOReport power ([ADR 0010](0010-sudoless-sensor-sources.md)).

## Consequences

- A second Rust target in the monorepo that Turbo and CI must know about.
- `target/` directories per crate unless a workspace is introduced later.
- The CLI is distributed by `cargo install --path crates/system-health` only, for now.

## Non-goals

Publishing the crate to crates.io; a Homebrew formula for the CLI; Linux or Windows sensor adapters.

## Reopen when

- A second crate needs sharing (then: root workspace), or
- `chapay ports` gets a real user (then: extract Ports), or
- crate-only fixes are delayed by the release-please path rule more than once.
