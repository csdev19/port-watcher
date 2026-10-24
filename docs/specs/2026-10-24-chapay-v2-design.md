# chapay v2 — Machine mode next to Ports

Date: 2026-10-24 · Status: approved by the owner; implementation in phases on `feat/chapay-v2` ·
Owner: csdev19 · Issue: #55

Implementation status: nothing of v2 is on `main`. Phase 0 (this document, ADRs 0008–0012, the
research note and the `examples/thermal-probe` spike) is the first PR into `feat/chapay-v2`.

## Summary (one minute)

chapay becomes the watchman of the developer's machine, still one menu-bar app. The panel gets two
tabs: **Ports** (what ships today, re-skinned) and **Machine** — CPU, GPU, heat and memory gauges with
a reference band each, and the processes behind them with the same guarded kill. A full window adds
history, a process table with a Ports column, and alert rules. Alerts tell the owner before the laptop
overheats, at near-zero idle cost: the default alerts listen to macOS events (thermal and memory
pressure) instead of polling. Sensor data is read without sudo by our own Rust code, in a new
`crates/system-health` crate that also ships a `chapay` CLI. The visual source is the "Chapaq Panel v2"
Claude Design canvas, with the name kept as **chapay**.

| #   | Decision                                                                                                  | Why                                                                    | ADR                     |
| --- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------- |
| 1   | One app with two tabs, two bounded contexts (Ports, System health), no shared kernel                      | Same user, same moment, same kill flow; one release pipeline           | 0008 (new)              |
| 2   | System health in `crates/system-health` + `chapay` CLI; Ports stays in the desktop crate                  | System health has two consumers now, Ports has one                     | 0009 (new)              |
| 3   | Sensors from sudoless sources (SMC, IORegistry, mach, libproc, notify), our own code                      | Measured readable without a helper on M4 Pro                           | 0010 (new)              |
| 4   | Default alerts are event-driven (thermal, memory pressure); optional CPU/GPU rules poll ≥ 30 s            | Owner: alerts at optimal cost; CPU % and swap are bad default triggers | 0011 (new), amends 0001 |
| 5   | STOP comes from thermal pressure; CPU/GPU % reach WATCH at most                                           | 12 cores at 100 % stayed at nominal pressure, 77 °C                    | 0011                    |
| 6   | v2 palette, light theme, `chapay.` wordmark; sweep visible "chapaq" to "chapay"                           | Owner: the name is chapay everywhere                                   | 0012 (new), amends 0002 |
| 7   | Kill policy unchanged: ADR 0006 still decides; Machine kills go through the same Rust guard               | One policy, enforced in Rust                                           | reuses 0006             |
| 8   | Full window minimal: Overview, Ports, Alerts (+ Settings opens the existing window); Dock icon while open | Product rule: only what leads to an action                             | none                    |
| 9   | Delivery in waves: 1+2, then 3+4, then 5, then 6; one PR per phase into `feat/chapay-v2`                  | Phases share files; parallel only where independent                    | none                    |

### Open questions

1. Does SMC/IORegistry/notify reading work inside the Developer ID signed, notarized app? (Phase 2,
   first task; ADR 0010's reopen condition.)
2. Does thermal pressure leave nominal when the local LLM overheats the laptop, or only the hotspot
   rises? (Owner's hot capture with `hot-capture.sh`; may change the default STOP rule.)
3. Does `prefers-color-scheme` follow live appearance changes in the panel window? (Phase 1.)
4. The thermal-pressure-level → Nominal/Fair/Serious/Critical mapping under real heat.

### Out of scope

Network, disk, Bluetooth, fan control, per-core bars, separate CPU/GPU/Heat pages, user-defined alert
rules or editable thresholds, renaming the product, repo, scope, crate or bundle id, Windows/Linux,
anything that needs sudo.

### Failures this must protect against

- Killing a critical same-user process from the Machine tab (e.g. `loginwindow`) — the Rust guard must
  refuse it (ADR 0006 policy extended to non-listening processes).
- Killing the wrong process after PID reuse — every kill carries PID + start time.
- An alert that fires on an idle machine — replaying `examples/thermal-probe/measurements/*/probe.csv`
  produces zero firings.
- Notification spam — cooldown 15 min per alert, ≤ 4 per hour, none while the panel is visible.
- Battery drain with the panel closed — with default rules, no periodic timer runs.
- A missing sensor crashing or blanking the Machine tab — each source degrades to "unavailable".
- Power-gated cores read as 40.0 °C and dragging averages down — excluded in the domain layer.
- A visible "chapaq" left anywhere after Phase 1.

## Detail

### Glossary

- **Sample** — one reading of every available source at one instant.
- **Sensor** — a named reading (e.g. SMC `Tp0U`) with a kind (P-core, E-core, GPU) and validity.
- **Threshold** — the band edges for a metric (ok / warn / stop).
- **Verdict** — OK, WATCH or STOP for the machine, with reasons.
- **Attribution** — the process (or app group) driving a metric at that moment.
- **Hotspot** — the maximum valid CPU sensor reading.

### Reference bands (defaults)

| Gauge  | OK                       | WATCH                    | STOP                 |
| ------ | ------------------------ | ------------------------ | -------------------- |
| Heat   | thermal pressure nominal | Fair, or hotspot ≥ 80 °C | Serious or Critical  |
| CPU    | < 50 %                   | ≥ 50 % sustained         | — (never STOP alone) |
| GPU    | < 60 %                   | ≥ 60 % sustained         | — (never STOP alone) |
| Memory | pressure normal          | pressure warning         | pressure critical    |

### Phases

| Phase | Scope                                                                                                                         | Depends on |
| ----- | ----------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 1     | v2 skin of the panel (7a/7b), wordmark, light theme, fonts, "chapaq" → "chapay" sweep                                         | —          |
| 2     | `crates/system-health` + `chapay` CLI from the spike; event subscriptions for thermal and memory pressure; signed-build check | —          |
| 3     | Machine tab (10a): four gauges with 60 s sparklines, top processes grouped by app, guarded `kill_process`                     | 1, 2       |
| 4     | Gap work on the existing Settings and setup windows for 9a/8a (v2 skin, missing settings, window focus/blur fixes)            | 1          |
| 5     | Alerts: event-driven defaults, optional rules, in-panel band, notifications, tray signal                                      | 2, 3, 4    |
| 6     | Full window (10b), minimal scope                                                                                              | 3, 5       |

Each phase has a working plan in `docs/plans/` while it is in flight; the PR that ships a phase
deletes its plan.

### Where the canvas and this spec differ

| Canvas                                           | This spec                                                   | Reason                               |
| ------------------------------------------------ | ----------------------------------------------------------- | ------------------------------------ |
| "chapaq"                                         | "chapay"                                                    | Owner decision                       |
| Degrees, watts and per-process GPU need a helper | Read without sudo                                           | Measured (ADR 0010)                  |
| CPU warn 50 % / stop 80 % for 2 min              | CPU never STOPs alone; STOP from thermal pressure           | Measured                             |
| Three gauges                                     | Four (memory added)                                         | Memory is the tight resource at idle |
| "Closed, chapay doesn't poll at all"             | True for default alerts (event-driven); optional rules poll | ADR 0011                             |
| M2 Pro, 10 cores mock                            | Real core layout from the device tree                       | Mock data                            |
| Apps & system rows locked                        | ADR 0006 policy unchanged; only the look is taken           | Existing accepted ADR                |

### References

- Research: [thermal baseline, M4 Pro](../research/2026-10-23-thermal-baseline-m4-pro.md).
- Spike: [`examples/thermal-probe`](../../examples/thermal-probe).
- Prior art: [macmon](https://github.com/vladkens/macmon) (sudoless Apple Silicon metrics in Rust),
  [Stats](https://github.com/exelban/stats) (menu-bar monitor; sensors are its most expensive module).
- Earlier specs: [MVP](2026-09-15-chapay-mvp-spec.md), [panel UI](2026-09-16-panel-ui-stylex-design.md),
  [auto-updater](2026-10-13-desktop-auto-updater.md).
