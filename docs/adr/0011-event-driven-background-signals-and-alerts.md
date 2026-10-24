# ADR 0011: background signals are event-driven; alerts at near-zero idle cost

**Status:** Accepted by the owner (2026-10-24). Not implemented: Phase 5 on `feat/chapay-v2`.
Amends the "notifications" and "background monitoring" non-goals of
[ADR 0001](0001-desktop-categories-and-watched-ports.md) for the cases below.
**Date:** 2026-10-24.
**Spec:** [docs/specs/2026-10-24-chapay-v2-design.md](../specs/2026-10-24-chapay-v2-design.md).

## Context

chapay polls only while the panel is visible. The owner wants alerts ("tell me before it gets
hot") but the optimal cost: always-on polling costs energy, and a menu-bar app that drains battery
defeats its purpose. Measurements show CPU % alone is not a heat danger and swap size is flat at
idle, so neither is a good default trigger.

## Decision

- **Default-on alerts use operating-system events, not polling:**
  - thermal pressure ≥ heavy ("Serious") sustained 30 s → STOP, via `notify(3)` change notifications
    on `com.apple.system.thermalpressurelevel`;
  - memory pressure at warning sustained 60 s → WATCH, via a `DISPATCH_SOURCE_TYPE_MEMORYPRESSURE`
    source.
    With only these on, **nothing is sampled periodically while the panel is closed**. When an event
    fires, chapay samples once to name the culprit (Attribution).
- **Optional rules, off by default:** CPU ≥ 80 % for 2 min, GPU ≥ 90 % for 2 min. While one is on,
  chapay samples every ≥ 30 s with timer slack, utility QoS, no App Nap opt-out.
- **Panel or full window visible:** 1 Hz sampling, as the Ports panel does today.
- Each rule has fire and clear windows (hysteresis), a 15-minute cooldown, at most 4 notifications
  per hour, and none while the panel is visible. Thresholds are fixed; rules are on/off switches.
- Each context emits its own events (System health: health transitions; Ports: watched port taken);
  an app-level `alerts` module in the desktop crate owns cooldowns, the tray signal and notifications.
  No generic rule engine.

## Alternatives rejected

- **Always-on periodic sampling (10–15 s).** Measurable idle cost for signals the OS already pushes.
- **No background work at all.** No alert can exist; the owner explicitly wants one.
- **A swap-size or CPU % default.** Fires constantly on this machine (swap flat at 3.2 GB; builds hit
  100 % CPU at nominal pressure).

## Consequences

- History has gaps while nothing is visible and only event rules are on; charts draw them as
  "not sampled".
- Watched ports must be readable from Rust for the "port taken" rule.
- The default STOP rule has not been observed firing yet; the local-LLM capture may move the default
  to a hotspot rule (see the research note).

## Non-goals

User-defined rules and editable thresholds; alert history; remote or push notifications.

## Reopen when

- The overheating capture shows thermal pressure stays nominal while the hotspot passes 95 °C, or
- event sources prove unreliable (missed transitions) on a supported macOS version, or
- idle energy impact with defaults exceeds the target (< 0.1 % CPU, ≤ 4 wake-ups/min).
