# ADR 0010: thermal warnings come from macOS `thermalState`; °C bands are context only

**Status:** accepted (2026-11-04); implemented on branch `feat/temperature-guard`, not on `main`
until that PR merges.
**Date:** 2026-11-04.
**Spec:** [docs/specs/2026-11-04-temperature-guard-design.md](../specs/2026-11-04-temperature-guard-design.md).

## Context

The owner wants to know what temperature is normal and what is worrying. Apple publishes no die
temperature thresholds for Apple Silicon, and the sensors report no critical value (`sysinfo`
returns `critical = None` for all 41 sensors on an M5). Community reports put idle at 40–50 °C,
sustained load near 100 °C and throttling around 100–107 °C, varying by model and room
temperature. macOS does expose `ProcessInfo.thermalState` (nominal, fair, serious, critical),
the system's own judgement of thermal pressure.

## Decision

Warnings and notifications trigger on `thermalState` (serious or critical). The temperature is
shown with a band (cool, normal, warm, hot, throttling) whose edges come from community reports,
and the UI says so. Once the history holds a day of data, the reading is also compared with the
owner's 7-day average. Peaks additionally use a 95 °C hottest-sensor threshold, because a peak
record is cheap and useful even when macOS does not yet report pressure.

## Alternatives rejected

- **Fixed °C thresholds for warnings.** Presents forum numbers as if they were limits; a fanless
  Air and a Mac Studio behave differently.
- **`thermalState` alone.** Authoritative but almost always `nominal`; it gives the owner no
  sense of what the number means.

## Consequences

- A warning may lag the temperature: macOS raises `thermalState` when it decides to act.
- The band copy must say where the numbers come from.

## Non-goals

- Per-model threshold tables.

## What would reopen this

Apple publishing die temperature limits, or a month of the owner's data showing the bands
mislabel ordinary work.
