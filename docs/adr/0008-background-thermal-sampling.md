# ADR 0008: thermal sampling runs in the background, also while the panel is hidden

**Status:** accepted (2026-11-04); implemented on branch `feat/temperature-guard`, not on `main`
until that PR merges.
**Date:** 2026-11-04.
**Spec:** [docs/specs/2026-11-04-temperature-guard-design.md](../specs/2026-11-04-temperature-guard-design.md).
**Amends:** the MVP spec's "zero polling while hidden" rule
(`docs/specs/2026-09-15-chapay-mvp-spec.md`, MVP scope item 2), for thermal sampling only.

## Context

Until now chapay did no work while the panel was hidden: the port list polls every 2 s only while
it is visible. The temperature guard must record peaks that happen while the owner is working in
other apps, which is when the panel is closed.

## Decision

A Rust background task samples the SoC temperature and `thermalState` every 60 s whenever the
`thermalGuardEnabled` setting is on (the default). The port list keeps its rule: no port polling
while hidden. With the guard off the task reads no sensor.

## Alternatives rejected

- **Sample only while the panel or Settings is open.** Misses almost every peak; the history
  would describe when the owner looked, not how the Mac ran.
- **A separate launchd agent.** Survives quitting chapay, but adds a second binary, an install
  step and its own lifecycle for a menu-bar app that already launches at login.
- **Faster sampling (every 5–10 s).** More precise peaks for six to twelve times the reads; the
  5-minute buckets would not use the extra detail.

## Consequences

- chapay does a small amount of work every minute: one sensor read (~60 ms measured on an M5) and
  one CPU refresh of the process table.
- Peaks shorter than a minute can be missed; `thermalState` changes last longer than that.
- History stops while chapay is not running; the gap is visible in the chart.

## Non-goals

- Polling ports in the background.
- Any action other than recording and notifying.

## What would reopen this

A measurement showing the sampler costs more than 1 % of a CPU core on average, or a need to
record while chapay is not running.
