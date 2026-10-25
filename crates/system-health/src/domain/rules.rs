//! Alert rules as a pure state machine (ADR 0011, amended). It decides *when a condition has
//! held long enough to fire* and *when it has stayed away long enough to clear*; it never reads
//! the machine, sleeps or sends anything. The caller feeds events and readings with an injected
//! clock and acts on the transitions it returns.
//!
//! Two kinds of rule:
//!
//! - **Event rules** (thermal pressure, memory pressure) are fed by OS change notifications. A
//!   pending rule exposes a one-shot deadline through [`HealthRules::next_deadline`]; at that
//!   deadline the caller re-reads the current level and calls [`HealthRules::on_deadline`]. There
//!   is no periodic work.
//! - **Polled rules** (CPU hotspot, CPU load, GPU load) are fed by [`Readings`] at whatever
//!   cadence the caller samples. Their windows are wall-clock durations, so a 30 s cadence fires
//!   correctly: the rule fires on the first reading at or after the window.
//!
//! Thresholds and windows are fixed constants, not user settings.

use super::memory::MemoryPressure;
use super::sample::Sample;
use super::thermal::ThermalPressure;
use super::verdict::Level;
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HealthRuleId {
    ThermalPressure,
    Hotspot,
    MemoryPressure,
    CpuSustained,
    GpuSustained,
}

impl HealthRuleId {
    pub const ALL: [HealthRuleId; 5] = [
        HealthRuleId::ThermalPressure,
        HealthRuleId::Hotspot,
        HealthRuleId::MemoryPressure,
        HealthRuleId::CpuSustained,
        HealthRuleId::GpuSustained,
    ];

    /// The rules that are on with default settings.
    pub const DEFAULT_ON: [HealthRuleId; 3] = [
        HealthRuleId::ThermalPressure,
        HealthRuleId::Hotspot,
        HealthRuleId::MemoryPressure,
    ];

    pub fn level(self) -> Level {
        match self {
            Self::ThermalPressure | Self::Hotspot => Level::Stop,
            Self::MemoryPressure | Self::CpuSustained | Self::GpuSustained => Level::Watch,
        }
    }

    /// Event rules are woken by the OS; the others need readings.
    pub fn is_event(self) -> bool {
        matches!(self, Self::ThermalPressure | Self::MemoryPressure)
    }

    /// How long the condition must hold before the rule fires.
    pub fn fire_after(self) -> Duration {
        Duration::from_secs(match self {
            Self::ThermalPressure => 30,
            Self::Hotspot => 60,
            Self::MemoryPressure => 60,
            Self::CpuSustained | Self::GpuSustained => 120,
        })
    }

    /// How long the condition must stay away before the rule clears.
    pub fn clear_after(self) -> Duration {
        Duration::from_secs(match self {
            Self::MemoryPressure => 120,
            _ => 60,
        })
    }
}

/// Hotspot stop line (matches `Thresholds::default().hotspot_c.stop`) and the level it must
/// fall below before the rule can start clearing.
pub const HOTSPOT_FIRE_C: f32 = 95.0;
pub const HOTSPOT_CLEAR_C: f32 = 90.0;
pub const CPU_FIRE_PCT: f32 = 80.0;
pub const CPU_CLEAR_PCT: f32 = 60.0;
pub const GPU_FIRE_PCT: f32 = 90.0;
pub const GPU_CLEAR_PCT: f32 = 70.0;
/// A pause between readings longer than this (sleep, wake, a closed panel with polling off)
/// restarts the polled rules' fire windows, so two readings an hour apart never count as
/// "sustained".
pub const MAX_READING_GAP: Duration = Duration::from_secs(100);

/// What the polled rules need from one reading. Any field may be unknown.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Readings {
    /// Whole-machine CPU load, 0 to 100.
    pub cpu_pct: Option<f32>,
    pub gpu_pct: Option<f32>,
    /// The hottest usable CPU sensor, in Celsius.
    pub hotspot_c: Option<f32>,
}

impl Readings {
    pub fn from_sample(s: &Sample) -> Self {
        Self {
            cpu_pct: s.cpu.as_ref().map(|c| c.total_pct),
            gpu_pct: s.gpu_pct.map(f32::from),
            hotspot_c: s.heat.as_ref().map(|h| h.cpu_max_c),
        }
    }
}

/// What a caller has to read to keep the enabled polled rules fed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Needs {
    pub cpu: bool,
    pub gpu: bool,
    pub hotspot: bool,
}

impl Needs {
    pub fn any(self) -> bool {
        self.cpu || self.gpu || self.hotspot
    }

    /// Only the hotspot: a cheap SMC read, no CPU load or GPU walk.
    pub fn hotspot_only(self) -> bool {
        self.hotspot && !self.cpu && !self.gpu
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum HealthInput {
    Thermal(ThermalPressure),
    Memory(MemoryPressure),
    Readings(Readings),
}

#[derive(Debug, Clone, PartialEq)]
pub enum HealthTransition {
    /// The condition just started holding. The caller primes attribution here.
    Pending {
        rule: HealthRuleId,
    },
    Fired {
        rule: HealthRuleId,
        level: Level,
        /// A short human reading, for example "Serious" or "97 °C".
        reading: String,
    },
    Cleared {
        rule: HealthRuleId,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Cond {
    Hot,
    Cool,
    /// Between the fire and clear lines (or unknown): changes nothing, resets a clear timer.
    Hold,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Phase {
    Idle,
    Pending(Instant),
    Firing,
    Clearing(Instant),
}

#[derive(Debug, Clone, Copy)]
struct RuleState {
    enabled: bool,
    phase: Phase,
}

pub struct HealthRules {
    rules: [RuleState; 5],
    thermal: Option<ThermalPressure>,
    memory: Option<MemoryPressure>,
    readings: Readings,
    last_readings_at: Option<Instant>,
}

fn index(rule: HealthRuleId) -> usize {
    HealthRuleId::ALL
        .iter()
        .position(|r| *r == rule)
        .expect("every rule is in ALL")
}

impl HealthRules {
    pub fn new(enabled: &[HealthRuleId]) -> Self {
        let mut rules = [RuleState {
            enabled: false,
            phase: Phase::Idle,
        }; 5];
        for rule in enabled {
            rules[index(*rule)].enabled = true;
        }
        Self {
            rules,
            thermal: None,
            memory: None,
            readings: Readings::default(),
            last_readings_at: None,
        }
    }

    pub fn is_enabled(&self, rule: HealthRuleId) -> bool {
        self.rules[index(rule)].enabled
    }

    pub fn is_firing(&self, rule: HealthRuleId) -> bool {
        matches!(
            self.rules[index(rule)].phase,
            Phase::Firing | Phase::Clearing(_)
        )
    }

    /// Replaces the enabled set. Disabling a firing rule clears it. Enabling an event rule
    /// judges it from the last level seen; a polled rule waits for its next reading.
    pub fn set_enabled(&mut self, enabled: &[HealthRuleId], now: Instant) -> Vec<HealthTransition> {
        let mut out = Vec::new();
        for rule in HealthRuleId::ALL {
            let want = enabled.contains(&rule);
            let st = &mut self.rules[index(rule)];
            if st.enabled == want {
                continue;
            }
            st.enabled = want;
            if !want {
                if matches!(st.phase, Phase::Firing | Phase::Clearing(_)) {
                    out.push(HealthTransition::Cleared { rule });
                }
                st.phase = Phase::Idle;
            } else if rule.is_event() {
                self.step(rule, now, &mut out);
            }
        }
        out
    }

    pub fn on_input(&mut self, input: HealthInput, now: Instant) -> Vec<HealthTransition> {
        let mut out = Vec::new();
        match input {
            HealthInput::Thermal(p) => {
                self.thermal = Some(p);
                self.step(HealthRuleId::ThermalPressure, now, &mut out);
            }
            HealthInput::Memory(p) => {
                self.memory = Some(p);
                self.step(HealthRuleId::MemoryPressure, now, &mut out);
            }
            HealthInput::Readings(r) => {
                if self
                    .last_readings_at
                    .is_some_and(|at| now.saturating_duration_since(at) > MAX_READING_GAP)
                {
                    for rule in HealthRuleId::ALL.into_iter().filter(|r| !r.is_event()) {
                        let st = &mut self.rules[index(rule)];
                        if matches!(st.phase, Phase::Pending(_)) {
                            st.phase = Phase::Idle;
                        }
                    }
                }
                self.last_readings_at = Some(now);
                self.readings = r;
                for rule in HealthRuleId::ALL.into_iter().filter(|r| !r.is_event()) {
                    self.step(rule, now, &mut out);
                }
            }
        }
        out
    }

    /// Called when [`next_deadline`](Self::next_deadline) has passed (and after a wake from
    /// sleep): the levels the OS reports *now* replace what the rules last saw.
    pub fn on_deadline(
        &mut self,
        current: (Option<ThermalPressure>, Option<MemoryPressure>),
        now: Instant,
    ) -> Vec<HealthTransition> {
        let mut out = Vec::new();
        if current.0.is_some() {
            self.thermal = current.0;
        }
        if current.1.is_some() {
            self.memory = current.1;
        }
        for rule in HealthRuleId::ALL.into_iter().filter(|r| r.is_event()) {
            self.step(rule, now, &mut out);
        }
        out
    }

    /// The earliest moment an enabled *event* rule needs a re-check. `None` when every event
    /// rule is idle or firing, which is the normal state: nothing to wake for.
    pub fn next_deadline(&self) -> Option<Instant> {
        HealthRuleId::ALL
            .into_iter()
            .filter(|r| r.is_event())
            .filter_map(|rule| {
                let st = self.rules[index(rule)];
                if !st.enabled {
                    return None;
                }
                match st.phase {
                    Phase::Pending(t) => Some(t + rule.fire_after()),
                    Phase::Clearing(t) => Some(t + rule.clear_after()),
                    Phase::Idle | Phase::Firing => None,
                }
            })
            .min()
    }

    /// What the enabled polled rules need read.
    pub fn needs(&self) -> Needs {
        Needs {
            cpu: self.is_enabled(HealthRuleId::CpuSustained),
            gpu: self.is_enabled(HealthRuleId::GpuSustained),
            hotspot: self.is_enabled(HealthRuleId::Hotspot),
        }
    }

    pub fn needs_polling(&self) -> bool {
        self.needs().any()
    }

    fn condition(&self, rule: HealthRuleId) -> Cond {
        let band = |v: Option<f32>, fire: f32, clear: f32| match v {
            Some(v) if v >= fire => Cond::Hot,
            Some(v) if v < clear => Cond::Cool,
            _ => Cond::Hold,
        };
        match rule {
            HealthRuleId::ThermalPressure => match self.thermal {
                Some(p) if p >= ThermalPressure::Serious => Cond::Hot,
                Some(_) => Cond::Cool,
                None => Cond::Hold,
            },
            HealthRuleId::MemoryPressure => match self.memory {
                Some(p) if p >= MemoryPressure::Warning => Cond::Hot,
                Some(_) => Cond::Cool,
                None => Cond::Hold,
            },
            HealthRuleId::Hotspot => band(self.readings.hotspot_c, HOTSPOT_FIRE_C, HOTSPOT_CLEAR_C),
            HealthRuleId::CpuSustained => band(self.readings.cpu_pct, CPU_FIRE_PCT, CPU_CLEAR_PCT),
            HealthRuleId::GpuSustained => band(self.readings.gpu_pct, GPU_FIRE_PCT, GPU_CLEAR_PCT),
        }
    }

    fn reading_text(&self, rule: HealthRuleId) -> String {
        match rule {
            HealthRuleId::ThermalPressure => self
                .thermal
                .map_or_else(String::new, |p| capitalised(p.label())),
            HealthRuleId::MemoryPressure => self
                .memory
                .map_or_else(String::new, |p| capitalised(p.label())),
            HealthRuleId::Hotspot => self
                .readings
                .hotspot_c
                .map_or_else(String::new, |c| format!("{c:.0} °C")),
            HealthRuleId::CpuSustained => self
                .readings
                .cpu_pct
                .map_or_else(String::new, |v| format!("{v:.0}%")),
            HealthRuleId::GpuSustained => self
                .readings
                .gpu_pct
                .map_or_else(String::new, |v| format!("{v:.0}%")),
        }
    }

    fn step(&mut self, rule: HealthRuleId, now: Instant, out: &mut Vec<HealthTransition>) {
        let i = index(rule);
        if !self.rules[i].enabled {
            return;
        }
        let cond = self.condition(rule);
        let fire_after = rule.fire_after();
        let clear_after = rule.clear_after();
        let st = &mut self.rules[i];
        match (st.phase, cond) {
            (Phase::Idle, Cond::Hot) => {
                st.phase = Phase::Pending(now);
                out.push(HealthTransition::Pending { rule });
                // A zero window would fire at once; none of the fixed windows is zero.
            }
            (Phase::Pending(since), Cond::Hot) => {
                if now.saturating_duration_since(since) >= fire_after {
                    st.phase = Phase::Firing;
                    let reading = self.reading_text(rule);
                    out.push(HealthTransition::Fired {
                        rule,
                        level: rule.level(),
                        reading,
                    });
                }
            }
            (Phase::Pending(_), _) => st.phase = Phase::Idle,
            (Phase::Firing, Cond::Cool) => st.phase = Phase::Clearing(now),
            (Phase::Clearing(since), Cond::Cool) => {
                if now.saturating_duration_since(since) >= clear_after {
                    st.phase = Phase::Idle;
                    out.push(HealthTransition::Cleared { rule });
                }
            }
            (Phase::Clearing(_), _) => st.phase = Phase::Firing,
            (Phase::Idle, _) | (Phase::Firing, _) => {}
        }
    }
}

fn capitalised(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        Some(c) => c.to_uppercase().collect::<String>() + chars.as_str(),
        None => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use HealthRuleId::*;

    fn secs(s: u64) -> Duration {
        Duration::from_secs(s)
    }

    fn hot(c: f32) -> HealthInput {
        HealthInput::Readings(Readings {
            hotspot_c: Some(c),
            ..Readings::default()
        })
    }

    fn fired(v: &[HealthTransition]) -> Vec<HealthRuleId> {
        v.iter()
            .filter_map(|t| match t {
                HealthTransition::Fired { rule, .. } => Some(*rule),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn thermal_goes_pending_then_fires_exactly_at_the_window() {
        let t0 = Instant::now();
        let mut r = HealthRules::new(&[ThermalPressure]);
        let v = r.on_input(HealthInput::Thermal(super::ThermalPressure::Serious), t0);
        assert_eq!(
            v,
            [HealthTransition::Pending {
                rule: ThermalPressure
            }]
        );
        assert_eq!(r.next_deadline(), Some(t0 + secs(30)));
        // One tick early: nothing.
        assert!(
            r.on_deadline((Some(super::ThermalPressure::Serious), None), t0 + secs(29))
                .is_empty()
        );
        let v = r.on_deadline((Some(super::ThermalPressure::Serious), None), t0 + secs(30));
        assert_eq!(
            v,
            [HealthTransition::Fired {
                rule: ThermalPressure,
                level: Level::Stop,
                reading: "Serious".into()
            }]
        );
        assert!(r.is_firing(ThermalPressure));
        assert_eq!(r.next_deadline(), None);
    }

    #[test]
    fn a_blip_inside_the_window_never_fires() {
        let t0 = Instant::now();
        let mut r = HealthRules::new(&[ThermalPressure]);
        r.on_input(HealthInput::Thermal(super::ThermalPressure::Serious), t0);
        r.on_input(
            HealthInput::Thermal(super::ThermalPressure::Fair),
            t0 + secs(10),
        );
        assert_eq!(r.next_deadline(), None);
        // The deadline of the abandoned episode must not fire anything.
        let v = r.on_deadline((Some(super::ThermalPressure::Fair), None), t0 + secs(40));
        assert!(v.is_empty());
        assert!(!r.is_firing(ThermalPressure));
    }

    #[test]
    fn oscillation_inside_the_window_restarts_it() {
        let t0 = Instant::now();
        let mut r = HealthRules::new(&[ThermalPressure]);
        r.on_input(HealthInput::Thermal(super::ThermalPressure::Serious), t0);
        r.on_input(
            HealthInput::Thermal(super::ThermalPressure::Fair),
            t0 + secs(20),
        );
        r.on_input(
            HealthInput::Thermal(super::ThermalPressure::Serious),
            t0 + secs(25),
        );
        assert_eq!(r.next_deadline(), Some(t0 + secs(55)));
    }

    #[test]
    fn clears_after_the_clear_window() {
        let t0 = Instant::now();
        let mut r = HealthRules::new(&[ThermalPressure]);
        r.on_input(HealthInput::Thermal(super::ThermalPressure::Critical), t0);
        r.on_deadline(
            (Some(super::ThermalPressure::Critical), None),
            t0 + secs(30),
        );
        let t1 = t0 + secs(100);
        r.on_input(HealthInput::Thermal(super::ThermalPressure::Nominal), t1);
        assert!(r.is_firing(ThermalPressure), "still firing while clearing");
        assert_eq!(r.next_deadline(), Some(t1 + secs(60)));
        let v = r.on_deadline((Some(super::ThermalPressure::Nominal), None), t1 + secs(60));
        assert_eq!(
            v,
            [HealthTransition::Cleared {
                rule: ThermalPressure
            }]
        );
        assert!(!r.is_firing(ThermalPressure));
    }

    #[test]
    fn pressure_returning_while_clearing_keeps_the_rule_firing() {
        let t0 = Instant::now();
        let mut r = HealthRules::new(&[MemoryPressure]);
        r.on_input(HealthInput::Memory(super::MemoryPressure::Warning), t0);
        r.on_deadline((None, Some(super::MemoryPressure::Warning)), t0 + secs(60));
        let t1 = t0 + secs(200);
        r.on_input(HealthInput::Memory(super::MemoryPressure::Normal), t1);
        r.on_input(
            HealthInput::Memory(super::MemoryPressure::Warning),
            t1 + secs(30),
        );
        assert_eq!(r.next_deadline(), None);
        assert!(
            r.on_deadline((None, Some(super::MemoryPressure::Warning)), t1 + secs(200))
                .is_empty()
        );
        assert!(r.is_firing(MemoryPressure));
    }

    #[test]
    fn memory_fires_at_warning_after_60_seconds_as_watch() {
        let t0 = Instant::now();
        let mut r = HealthRules::new(&[MemoryPressure]);
        r.on_input(HealthInput::Memory(super::MemoryPressure::Warning), t0);
        let v = r.on_deadline((None, Some(super::MemoryPressure::Warning)), t0 + secs(60));
        assert_eq!(
            v,
            [HealthTransition::Fired {
                rule: MemoryPressure,
                level: Level::Watch,
                reading: "Warning".into()
            }]
        );
    }

    #[test]
    fn hotspot_needs_two_readings_a_window_apart() {
        let t0 = Instant::now();
        let mut r = HealthRules::new(&[Hotspot]);
        let v = r.on_input(hot(97.0), t0);
        assert_eq!(v, [HealthTransition::Pending { rule: Hotspot }]);
        assert!(r.on_input(hot(98.0), t0 + secs(30)).is_empty());
        let v = r.on_input(hot(99.0), t0 + secs(60));
        assert_eq!(
            v,
            [HealthTransition::Fired {
                rule: Hotspot,
                level: Level::Stop,
                reading: "99 °C".into()
            }]
        );
    }

    #[test]
    fn hotspot_dip_below_the_line_resets_the_window() {
        let t0 = Instant::now();
        let mut r = HealthRules::new(&[Hotspot]);
        r.on_input(hot(97.0), t0);
        r.on_input(hot(85.0), t0 + secs(30));
        r.on_input(hot(97.0), t0 + secs(60));
        assert!(fired(&r.on_input(hot(97.0), t0 + secs(90))).is_empty());
        assert_eq!(fired(&r.on_input(hot(97.0), t0 + secs(120))), [Hotspot]);
    }

    #[test]
    fn hotspot_clears_below_90_after_a_minute_and_not_in_the_hold_band() {
        let t0 = Instant::now();
        let mut r = HealthRules::new(&[Hotspot]);
        r.on_input(hot(100.0), t0);
        r.on_input(hot(100.0), t0 + secs(60));
        assert!(r.is_firing(Hotspot));
        // 92 C is between the lines: it neither clears nor re-fires.
        r.on_input(hot(92.0), t0 + secs(90));
        r.on_input(hot(85.0), t0 + secs(120));
        assert!(r.on_input(hot(85.0), t0 + secs(150)).is_empty());
        let v = r.on_input(hot(85.0), t0 + secs(180));
        assert_eq!(v, [HealthTransition::Cleared { rule: Hotspot }]);
    }

    #[test]
    fn a_long_gap_between_readings_restarts_the_window() {
        let t0 = Instant::now();
        let mut r = HealthRules::new(&[Hotspot]);
        r.on_input(hot(97.0), t0);
        // The Mac slept for an hour; one hot reading before and one after is not "sustained".
        let v = r.on_input(hot(97.0), t0 + secs(3600));
        assert_eq!(v, [HealthTransition::Pending { rule: Hotspot }]);
    }

    #[test]
    fn cpu_and_gpu_rules_use_their_own_lines_and_windows() {
        let t0 = Instant::now();
        let mut r = HealthRules::new(&[CpuSustained, GpuSustained]);
        let reading = |cpu, gpu| {
            HealthInput::Readings(Readings {
                cpu_pct: Some(cpu),
                gpu_pct: Some(gpu),
                hotspot_c: None,
            })
        };
        r.on_input(reading(85.0, 85.0), t0);
        let v = r.on_input(reading(85.0, 95.0), t0 + secs(60));
        assert!(fired(&v).is_empty());
        r.on_input(reading(85.0, 95.0), t0 + secs(90));
        let v = r.on_input(reading(85.0, 95.0), t0 + secs(120));
        // CPU has held 120 s; the GPU only crossed at t0+60 (its 85 % never counted).
        assert_eq!(fired(&v), [CpuSustained]);
        let v = r.on_input(reading(85.0, 95.0), t0 + secs(180));
        assert_eq!(fired(&v), [GpuSustained]);
    }

    #[test]
    fn disabling_a_firing_rule_clears_it_and_a_pending_one_silently() {
        let t0 = Instant::now();
        let mut r = HealthRules::new(&[Hotspot, ThermalPressure]);
        r.on_input(hot(99.0), t0);
        r.on_input(hot(99.0), t0 + secs(60));
        r.on_input(
            HealthInput::Thermal(super::ThermalPressure::Serious),
            t0 + secs(61),
        );
        assert!(r.is_firing(Hotspot));
        let v = r.set_enabled(&[], t0 + secs(62));
        assert_eq!(v, [HealthTransition::Cleared { rule: Hotspot }]);
        assert_eq!(r.next_deadline(), None);
        assert!(!r.needs_polling());
    }

    #[test]
    fn enabling_an_event_rule_judges_the_last_seen_level() {
        let t0 = Instant::now();
        let mut r = HealthRules::new(&[]);
        r.on_input(HealthInput::Thermal(super::ThermalPressure::Serious), t0);
        assert_eq!(r.next_deadline(), None, "disabled rules schedule nothing");
        let v = r.set_enabled(&[ThermalPressure], t0 + secs(5));
        assert_eq!(
            v,
            [HealthTransition::Pending {
                rule: ThermalPressure
            }]
        );
        assert_eq!(r.next_deadline(), Some(t0 + secs(35)));
    }

    #[test]
    fn idle_defaults_have_no_deadline_and_poll_the_hotspot_only() {
        let r = HealthRules::new(&HealthRuleId::DEFAULT_ON);
        assert_eq!(r.next_deadline(), None);
        assert!(r.needs_polling());
        assert!(r.needs().hotspot_only());
        let r = HealthRules::new(&[ThermalPressure, MemoryPressure]);
        assert!(!r.needs_polling());
        let r = HealthRules::new(&[CpuSustained]);
        assert!(r.needs().cpu && !r.needs().hotspot_only());
    }

    #[test]
    fn rule_ids_serialize_camel_case() {
        assert_eq!(serde_json::to_string(&Hotspot).unwrap(), "\"hotspot\"");
        assert_eq!(
            serde_json::to_string(&CpuSustained).unwrap(),
            "\"cpuSustained\""
        );
    }
}
