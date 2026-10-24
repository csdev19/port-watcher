# ADR 0010: sensor data comes from sudoless macOS sources, read by our own code

**Status:** Accepted by the owner (2026-10-24). Verified from a plain binary and an ad-hoc,
hardened-runtime re-signed binary on an M4 Pro; **not yet verified inside the Developer ID signed,
notarized app** (Phase 2 includes that check). Implemented in `crates/system-health` (Phase 2, on `feat/chapay-v2`); the app only logs it so far.
**Date:** 2026-10-24.
**Evidence:** [docs/research/2026-10-23-thermal-baseline-m4-pro.md](../research/2026-10-23-thermal-baseline-m4-pro.md).

## Context

The v2 design assumed Apple Silicon exposes no temperature without a privileged helper, and that
watts and per-process GPU need one too. The spike `examples/thermal-probe` and the Phase 2 and 6
investigations contradict that on this machine. chapay never asks for a password and never runs as
root (setup and permissions copy).

## Decision

| Metric                          | Source (no sudo)                                                                                                                                                       |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Temperatures, fan, system power | SMC through the `AppleSMC` IOKit user client; cache the key list, read only `Tp*`/`Te*`/`Tg*`, `F0Ac`/`F0Mx`, `PSTR`                                                   |
| GPU utilisation                 | IORegistry `IOAccelerator › PerformanceStatistics › Device Utilization %`                                                                                              |
| Per-process GPU                 | IORegistry GPU clients: `IOUserClientCreator` + `AppUsage.accumulatedGPUTime` (undocumented; column shows "—" when absent)                                             |
| CPU total / per core            | mach `host_statistics` / `host_processor_info`; P/E mapping from the device tree `cluster-type`                                                                        |
| Per-process CPU, memory, energy | `proc_pid_rusage` (V6)                                                                                                                                                 |
| Memory                          | `host_statistics64` + memory pressure level                                                                                                                            |
| Thermal pressure                | `notify(3)` on `com.apple.system.thermalpressurelevel`, mapped moderate → Fair, heavy → Serious, trapping/sleeping → Critical (mapping inferred, to verify under load) |

- **Our own code**, ported from the spike. No privileged helper.
- **IOReport** (CPU/GPU package power) is deferred; if needed, use the `macmon` crate rather than
  writing it.

## Alternatives rejected

- **A privileged helper / `powermetrics`.** Needs a password, a launch daemon and an install step —
  for data that is readable without them.
- **`ProcessInfo.thermalState`.** Equivalent signal but requires Objective-C bridging; `notify(3)` also
  gives change notifications ([ADR 0011](0011-event-driven-background-signals-and-alerts.md)).
- **`macmon` for everything.** See ADR 0009.

## Consequences

- SMC keys and IORegistry fields are undocumented and can change per chip or macOS release. Every
  source degrades to "unavailable" instead of failing the sample; the verdict falls back to what is
  left (thermal pressure first).
- The sensor classification table is per chip family and needs a check on each new generation.

## Non-goals

Intel Macs; fan control; writing SMC keys.

## Reopen when

- The signed, notarized app cannot read SMC or IORegistry (then: helper or reduced Machine mode), or
- a macOS release removes these sources, or
- package power (IOReport) becomes necessary for a verdict.
