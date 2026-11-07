# ADR 0011: memory is sampled on the thermal tick, from physical footprint, with four signals

**Status:** accepted (2026-11-07); implemented on branch `feat/memory-guard`, not on `main` until
that PR merges.
**Date:** 2026-11-07.
**Spec:** [docs/specs/2026-11-07-memory-guard-design.md](../specs/2026-11-07-memory-guard-design.md).
**Amends:** [ADR 0008](0008-background-thermal-sampling.md), whose decision limits background
sampling to "thermal sampling only". The same tick now also reads memory.

## Context

On 2026-10-29 and 2026-11-06 the owner's 24 GB Mac ran with 93–256 MB free and 12–18 GB of swap. A
root daemon (`zdpd`) had grown from 3.7 GB to 16 GB over one uptime of eight days. Activity Monitor
and chapay showed nothing useful: chapay lists only listening ports, and `sysinfo`'s per-process
memory on macOS is RSS, which omits compressed pages and reported the 16 GB daemon as about 1 GB.
Restarting the daemon brought the load from 28 to 7 within minutes.

Two decisions of the repo already shape the answer: background work exists only for the temperature
guard, every 60 s, behind a setting (ADR 0008); and history lives in a Rust-owned SQLite file
(ADR 0009). PR #67 (`feat/chapay-v2`) holds working sudoless readers for the same figures.

## Decision

- The thermal sampler's tick reads memory too, under the same `thermal.sampler.lock`, gated by its own
  `memoryGuardEnabled` setting (default on). No second timer.
- Per-process memory is `phys_footprint` from `proc_pid_rusage`; system memory from
  `host_statistics64` with Activity Monitor's breakdown (app + wired + compressed); swap from
  `vm.swapusage`; pressure from `kern.memorystatus_vm_pressure_level`. RSS is never shown.
- Four signals, with defaults the owner can edit in Settings: pressure ≥ warning; swap ≥ 80 %; one
  process ≥ 25 % of physical RAM; a process that doubled its footprint since its first retained sample
  and exceeds 2 GB. The verdict is OK / WATCH / STOP as the spec's table defines.
- Per-process samples are keyed by PID and start time, so growth is measured within one incarnation.
- **Root and other users' processes** (found during implementation, 2026-11-07): `proc_pid_rusage`
  returns nothing for them without privileges, and the motivating daemon runs as root. `/usr/bin/top`
  is the only sudoless source that reports their footprint, at about 1.1 s of CPU per run. The
  sampler therefore runs `top -l 1 -o mem` once per 5-minute bucket and merges its figures for the
  PIDs `proc_pid_rusage` cannot read; `proc_pid_rusage` still runs every tick for the rest. The
  open Memory tab reuses that snapshot when it is younger than 60 s and runs `top` once otherwise.
  Cost: about 0.37 % of one core for the background part, inside the budget.
- Readers are ported from `feat/chapay-v2`'s `crates/system-health` into the desktop crate as
  `src-tauri/src/memory/`, because that crate is not on `main` and the only consumer today is the app.

## Alternatives rejected

- **Memory pressure events only (as PR #67 does).** The OS event fires at warning and critical; it
  never says who, and it would not have shown the daemon growing for a week at pressure "normal".
- **RSS from the `sysinfo` refresh the tick already does.** Free, but wrong under swap: the figure
  that mattered was off by a factor of 16.
- **A second sampler with its own cadence.** Two wake-ups per minute for no gain; the memory read is
  cheaper than the sensor read.
- **`proc_pid_rusage` only.** Measured: 192 of 253 PIDs readable, none of the root ones; the
  feature's own motivating case would never appear.
- **`top` every tick.** 1.8 % of a core with the panel closed, over the ADR 0008 budget.
- **Reusing PR #67 wholesale.** 28 commits behind `main`, a red `cargo audit`, and ADRs 0008–0010
  that conflict with the ones `main` shipped for the temperature guard.

## Consequences

- One more read per minute: a few sysctls, one mach call and one `proc_pid_rusage` per PID. The
  budget of ADR 0008 (≤ 1 % of one core) now covers both guards; the spec names the fallback (sample
  only PIDs ≥ 256 MB RSS) if the budget is exceeded.
- `thermal.sqlite` gets schema step 2. The file name stays; renaming it would orphan existing history.
- The growth signal needs retained per-process samples; the top N per tick are kept, not every process.

## Non-goals

- Reading memory while the guard is off.
- An alert rule engine; the thresholds are four numbers in settings.

## What would reopen this

- The tick's measured cost exceeds 1 % of one core with both guards on.
- A merged Machine tab (PR #67's direction) needs one sampler for CPU, GPU, heat and memory; then the
  readers move to a shared crate and this ADR's placement is superseded.
