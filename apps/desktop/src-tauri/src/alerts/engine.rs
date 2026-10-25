//! The alert engine: one thread that owns every rule's state (ADR 0011).
//!
//! `Core` is the whole decision logic and touches the machine only through the `World` trait, so
//! it is tested with a fake world and a fake clock. `spawn` wraps it in a thread that blocks on
//! its inbox with the earliest deadline as the timeout:
//!
//! - thermal and memory pressure arrive as OS events, and a rule waiting out its window
//!   schedules one one-shot wake-up;
//! - while the hotspot, CPU, GPU or watched-port rule is on, the thread wakes every 30 s to read
//!   exactly what those rules need (with only the hotspot on that is a cached-key SMC read, no
//!   process walk), and reuses any sample the panel took in the last 30 s;
//! - with none of those on and nothing pending it blocks without a timeout and never wakes.

use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::time::{Duration, Instant};

use system_health::{
    HealthInput, HealthRuleId, HealthRules, HealthTransition, MemoryPressure, Needs, Readings,
    ThermalPressure,
};

use super::policy::{Decision, Policy};
use super::{ActiveAlert, AlertRuleId, AlertSettings, Culprit, EngineMsg, FocusTarget};
use crate::ports::models::PortEntry;
use crate::ports::watch::WatchedPortMonitor;

/// How often the polled rules read the machine while any of them is on.
pub const POLL_EVERY: Duration = Duration::from_secs(30);

/// How a firing rule's culprit is picked.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Attribution {
    /// The process using the most CPU since the rule went pending.
    Cpu,
    /// The process with the largest memory footprint.
    Memory,
    /// There is no honest per-process figure (GPU load is not reported per process).
    None,
}

fn attribution(rule: HealthRuleId) -> Attribution {
    match rule {
        HealthRuleId::ThermalPressure | HealthRuleId::Hotspot | HealthRuleId::CpuSustained => {
            Attribution::Cpu
        }
        HealthRuleId::MemoryPressure => Attribution::Memory,
        HealthRuleId::GpuSustained => Attribution::None,
    }
}

/// Everything the engine reads from outside. The production implementation is `AppWorld`.
pub trait World {
    fn thermal(&self) -> Option<ThermalPressure>;
    fn memory(&self) -> Option<MemoryPressure>;
    fn panel_visible(&self) -> bool;
    /// Reads what the enabled polled rules need, reusing a sample younger than `max_age`.
    fn read(&mut self, needs: Needs, max_age: Duration) -> Option<Readings>;
    /// Takes the process baseline that makes the culprit an average over the sustain window.
    fn prime(&mut self);
    fn culprit(&mut self, by: Attribution) -> Option<Culprit>;
    fn watched_ports(&self) -> Vec<u16>;
    /// Listeners on the given ports, enriched.
    fn listeners(&mut self, ports: &[u16]) -> Vec<PortEntry>;
    fn epoch_ms(&self) -> u64;
}

/// A native notification to post.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Notice {
    pub key: String,
    pub title: String,
    pub body: String,
    pub target: Option<FocusTarget>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Effect {
    /// The set of firing alerts changed.
    Publish(Vec<ActiveAlert>),
    Notify(Notice),
}

/// How long the engine may sleep: until the earliest rule deadline or the next poll, whichever
/// comes first; `None` means block until a message arrives.
pub fn next_wait(
    now: Instant,
    rule_deadline: Option<Instant>,
    polling: bool,
    last_poll: Option<Instant>,
) -> Option<Duration> {
    let poll_at = polling.then(|| last_poll.map_or(now, |at| at + POLL_EVERY));
    [rule_deadline, poll_at]
        .into_iter()
        .flatten()
        .min()
        .map(|at| at.saturating_duration_since(now))
}

pub struct Core {
    rules: HealthRules,
    settings: AlertSettings,
    monitor: WatchedPortMonitor,
    active: Vec<ActiveAlert>,
    policy: Policy,
    last_poll: Option<Instant>,
}

impl Core {
    pub fn new(settings: AlertSettings) -> Self {
        Self {
            rules: HealthRules::new(&settings.health_rules()),
            settings,
            monitor: WatchedPortMonitor::default(),
            active: Vec::new(),
            policy: Policy::default(),
            last_poll: None,
        }
    }

    #[cfg(test)]
    pub fn active(&self) -> &[ActiveAlert] {
        &self.active
    }

    fn port_rule_on(&self) -> bool {
        self.settings.is_enabled(AlertRuleId::WatchedPortTaken)
    }

    fn polling(&self) -> bool {
        self.rules.needs_polling() || self.port_rule_on()
    }

    pub fn wait(&self, now: Instant) -> Option<Duration> {
        next_wait(
            now,
            self.rules.next_deadline(),
            self.polling(),
            self.last_poll,
        )
    }

    pub fn handle(&mut self, msg: EngineMsg, now: Instant, world: &mut impl World) -> Vec<Effect> {
        let mut fx = Vec::new();
        match msg {
            EngineMsg::Thermal(p) => {
                let t = self.rules.on_input(HealthInput::Thermal(p), now);
                self.apply(t, now, world, &mut fx);
            }
            EngineMsg::Memory(p) => {
                let t = self.rules.on_input(HealthInput::Memory(p), now);
                self.apply(t, now, world, &mut fx);
            }
            EngineMsg::Readings(r) => {
                let t = self.rules.on_input(HealthInput::Readings(r), now);
                self.apply(t, now, world, &mut fx);
            }
            EngineMsg::Settings(s) => {
                self.settings = s;
                let t = self.rules.set_enabled(&s.health_rules(), now);
                self.apply(t, now, world, &mut fx);
                if !self.port_rule_on() {
                    self.drop_port_alerts(&mut fx);
                }
                // Poll soon so a newly enabled polled rule or the port baseline starts now.
                self.last_poll = None;
            }
        }
        self.tick(now, world, &mut fx);
        fx
    }

    /// Runs whatever is due: rule deadlines first, then the periodic read.
    pub fn tick(&mut self, now: Instant, world: &mut impl World, fx: &mut Vec<Effect>) {
        if self.rules.next_deadline().is_some_and(|d| d <= now) {
            let t = self
                .rules
                .on_deadline((world.thermal(), world.memory()), now);
            self.apply(t, now, world, fx);
        }
        let due = self
            .last_poll
            .is_none_or(|at| now.saturating_duration_since(at) >= POLL_EVERY);
        if self.polling() && due {
            self.last_poll = Some(now);
            let needs = self.rules.needs();
            if needs.any() {
                if let Some(r) = world.read(needs, POLL_EVERY) {
                    let t = self.rules.on_input(HealthInput::Readings(r), now);
                    self.apply(t, now, world, fx);
                }
            }
            if self.port_rule_on() {
                self.scan_ports(now, world, fx);
            }
        }
    }

    fn scan_ports(&mut self, now: Instant, world: &mut impl World, fx: &mut Vec<Effect>) {
        let watched = world.watched_ports();
        self.monitor.set_watched(watched.iter().copied());
        if watched.is_empty() {
            self.drop_port_alerts(fx);
            return;
        }
        let listeners = world.listeners(&watched);
        let taken = self.monitor.observe(&listeners);
        let mut changed = false;
        // A port alert ends when its owner no longer holds the port.
        let before = self.active.len();
        self.active.retain(|a| match (&a.rule, &a.culprit) {
            (AlertRuleId::WatchedPortTaken, Some(c)) => {
                let port = match a.target {
                    Some(FocusTarget::Port { port }) => port,
                    _ => return true,
                };
                listeners
                    .iter()
                    .any(|l| l.port == port && l.pid == c.pid && l.started_at == c.started_at)
            }
            _ => true,
        });
        changed |= self.active.len() != before;
        for t in taken {
            let alert = ActiveAlert::port(&t, world.epoch_ms());
            let notice = Notice {
                key: alert.id.clone(),
                title: alert.title.clone(),
                body: alert.reading.clone(),
                target: alert.target.clone(),
            };
            self.upsert(alert);
            changed = true;
            self.maybe_notify(notice, now, world, fx);
        }
        if changed {
            fx.push(Effect::Publish(self.active.clone()));
        }
    }

    fn drop_port_alerts(&mut self, fx: &mut Vec<Effect>) {
        let before = self.active.len();
        self.active
            .retain(|a| a.rule != AlertRuleId::WatchedPortTaken);
        if self.active.len() != before {
            fx.push(Effect::Publish(self.active.clone()));
        }
    }

    fn upsert(&mut self, alert: ActiveAlert) {
        match self.active.iter_mut().find(|a| a.id == alert.id) {
            Some(slot) => *slot = alert,
            None => self.active.push(alert),
        }
    }

    fn apply(
        &mut self,
        transitions: Vec<HealthTransition>,
        now: Instant,
        world: &mut impl World,
        fx: &mut Vec<Effect>,
    ) {
        for t in transitions {
            match t {
                HealthTransition::Pending { rule } => {
                    if attribution(rule) != Attribution::None {
                        world.prime();
                    }
                }
                HealthTransition::Fired {
                    rule,
                    level,
                    reading,
                } => {
                    let id = AlertRuleId::from_health(rule);
                    let culprit = match attribution(rule) {
                        Attribution::None => None,
                        by => world.culprit(by),
                    };
                    let alert = ActiveAlert::health(id, level, reading, culprit, world.epoch_ms());
                    let body = match (&alert.culprit, alert.reading.is_empty()) {
                        (Some(c), false) => format!("{} · {}", alert.reading, c.name),
                        (Some(c), true) => c.name.clone(),
                        (None, false) => alert.reading.clone(),
                        (None, true) => id.sub().to_string(),
                    };
                    let notice = Notice {
                        key: alert.id.clone(),
                        title: alert.title.clone(),
                        body,
                        target: alert.target.clone(),
                    };
                    self.upsert(alert);
                    fx.push(Effect::Publish(self.active.clone()));
                    self.maybe_notify(notice, now, world, fx);
                }
                HealthTransition::Cleared { rule } => {
                    let id = AlertRuleId::from_health(rule);
                    let before = self.active.len();
                    self.active.retain(|a| a.rule != id);
                    if self.active.len() != before {
                        fx.push(Effect::Publish(self.active.clone()));
                    }
                }
            }
        }
    }

    fn maybe_notify(
        &mut self,
        notice: Notice,
        now: Instant,
        world: &mut impl World,
        fx: &mut Vec<Effect>,
    ) {
        if self.policy.decide(&notice.key, now, world.panel_visible()) == Decision::Notify {
            fx.push(Effect::Notify(notice));
        }
    }
}

/// The thread body. Returns when the inbox is gone (the process ends with the thread).
pub fn run(
    mut core: Core,
    rx: Receiver<EngineMsg>,
    mut world: impl World,
    mut out: impl FnMut(Vec<Effect>),
) {
    loop {
        let now = Instant::now();
        let msg = match core.wait(now) {
            None => match rx.recv() {
                Ok(m) => Some(m),
                Err(_) => return,
            },
            Some(d) => match rx.recv_timeout(d) {
                Ok(m) => Some(m),
                Err(RecvTimeoutError::Timeout) => None,
                Err(RecvTimeoutError::Disconnected) => return,
            },
        };
        let now = Instant::now();
        let fx = match msg {
            Some(m) => core.handle(m, now, &mut world),
            None => {
                let mut fx = Vec::new();
                core.tick(now, &mut world, &mut fx);
                fx
            }
        };
        if !fx.is_empty() {
            out(fx);
        }
    }
}

/// Utility QoS: the OS may coalesce this thread's wake-ups with others (no App Nap opt-out; the
/// rules are minute-scale).
#[cfg(target_os = "macos")]
pub fn set_utility_qos() {
    unsafe extern "C" {
        fn pthread_set_qos_class_self_np(qos_class: u32, relative_priority: i32) -> i32;
    }
    const QOS_CLASS_UTILITY: u32 = 0x11;
    unsafe {
        pthread_set_qos_class_self_np(QOS_CLASS_UTILITY, 0);
    }
}

#[cfg(not(target_os = "macos"))]
pub fn set_utility_qos() {}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ports::classify::PortCategory;
    use std::collections::VecDeque;
    use system_health::Level;

    #[derive(Default)]
    struct Fake {
        thermal: Option<ThermalPressure>,
        memory: Option<MemoryPressure>,
        panel_visible: bool,
        readings: VecDeque<Readings>,
        reads: Vec<Needs>,
        primes: u32,
        culprit: Option<Culprit>,
        watched: Vec<u16>,
        listeners: Vec<PortEntry>,
        now_ms: u64,
    }

    impl World for Fake {
        fn thermal(&self) -> Option<ThermalPressure> {
            self.thermal
        }
        fn memory(&self) -> Option<MemoryPressure> {
            self.memory
        }
        fn panel_visible(&self) -> bool {
            self.panel_visible
        }
        fn read(&mut self, needs: Needs, _max_age: Duration) -> Option<Readings> {
            self.reads.push(needs);
            self.readings.pop_front()
        }
        fn prime(&mut self) {
            self.primes += 1;
        }
        fn culprit(&mut self, _by: Attribution) -> Option<Culprit> {
            self.culprit.clone()
        }
        fn watched_ports(&self) -> Vec<u16> {
            self.watched.clone()
        }
        fn listeners(&mut self, _ports: &[u16]) -> Vec<PortEntry> {
            self.listeners.clone()
        }
        fn epoch_ms(&self) -> u64 {
            self.now_ms
        }
    }

    fn secs(s: u64) -> Duration {
        Duration::from_secs(s)
    }

    fn ollama() -> Culprit {
        Culprit {
            pid: 321,
            started_at: 1,
            name: "ollama".into(),
            killable: true,
        }
    }

    fn settings(on: &[AlertRuleId]) -> AlertSettings {
        let mut s = AlertSettings::default();
        for r in AlertRuleId::ALL {
            s = s.with(r, on.contains(&r));
        }
        s
    }

    fn notices(fx: &[Effect]) -> Vec<&Notice> {
        fx.iter()
            .filter_map(|e| match e {
                Effect::Notify(n) => Some(n),
                _ => None,
            })
            .collect()
    }

    fn entry(port: u16, pid: u32, program: &str) -> PortEntry {
        PortEntry {
            port,
            pid,
            process_name: program.into(),
            command: program.into(),
            cwd: None,
            project: None,
            label: "Vite".into(),
            user: None,
            started_at: 1,
            memory_bytes: 0,
            killable: true,
            category: PortCategory::Dev,
            executable_path: None,
            app_bundle_path: None,
        }
    }

    #[test]
    fn next_wait_is_none_with_only_event_rules_and_nothing_pending() {
        let now = Instant::now();
        assert_eq!(next_wait(now, None, false, None), None);
        assert_eq!(next_wait(now, None, false, Some(now)), None);
    }

    #[test]
    fn next_wait_picks_the_earlier_of_deadline_and_poll() {
        let now = Instant::now();
        assert_eq!(next_wait(now, None, true, None), Some(Duration::ZERO));
        assert_eq!(next_wait(now, None, true, Some(now)), Some(POLL_EVERY));
        let last = now - secs(10);
        assert_eq!(next_wait(now, None, true, Some(last)), Some(secs(20)));
        assert_eq!(
            next_wait(now, Some(now + secs(5)), true, Some(last)),
            Some(secs(5))
        );
        assert_eq!(
            next_wait(now, Some(now + secs(50)), true, Some(last)),
            Some(secs(20))
        );
        // A deadline already past means "wake now".
        assert_eq!(
            next_wait(now + secs(60), Some(now), false, None),
            Some(Duration::ZERO)
        );
    }

    #[test]
    fn thermal_event_primes_then_fires_with_the_culprit_and_one_notice() {
        let t0 = Instant::now();
        let mut core = Core::new(settings(&[AlertRuleId::ThermalPressure]));
        let mut w = Fake {
            culprit: Some(ollama()),
            thermal: Some(ThermalPressure::Serious),
            now_ms: 5_000,
            ..Fake::default()
        };
        assert_eq!(core.wait(t0), None, "nothing pending, nothing polled");
        let fx = core.handle(EngineMsg::Thermal(ThermalPressure::Serious), t0, &mut w);
        assert!(fx.is_empty());
        assert_eq!(w.primes, 1);
        assert_eq!(core.wait(t0), Some(secs(30)));

        let mut fx = Vec::new();
        core.tick(t0 + secs(30), &mut w, &mut fx);
        let ns = notices(&fx);
        assert_eq!(ns.len(), 1);
        assert_eq!(ns[0].title, "Thermal pressure Serious");
        assert_eq!(ns[0].body, "Serious · ollama");
        assert_eq!(
            ns[0].target,
            Some(FocusTarget::Process {
                pid: 321,
                started_at: 1
            })
        );
        let Effect::Publish(active) = &fx[0] else {
            panic!("publish first: {fx:?}")
        };
        assert_eq!(active.len(), 1);
        assert_eq!(active[0].level, Level::Stop);
        assert_eq!(
            core.wait(t0 + secs(30)),
            None,
            "firing rules wait for events"
        );
    }

    #[test]
    fn a_visible_panel_gets_the_band_but_no_notification() {
        let t0 = Instant::now();
        let mut core = Core::new(settings(&[AlertRuleId::MemoryPressure]));
        let mut w = Fake {
            memory: Some(MemoryPressure::Warning),
            panel_visible: true,
            ..Fake::default()
        };
        core.handle(EngineMsg::Memory(MemoryPressure::Warning), t0, &mut w);
        let mut fx = Vec::new();
        core.tick(t0 + secs(60), &mut w, &mut fx);
        assert!(notices(&fx).is_empty());
        assert_eq!(core.active().len(), 1);
    }

    #[test]
    fn a_refire_inside_the_cooldown_updates_the_band_without_a_second_notice() {
        let t0 = Instant::now();
        let mut core = Core::new(settings(&[AlertRuleId::ThermalPressure]));
        let mut w = Fake {
            thermal: Some(ThermalPressure::Serious),
            ..Fake::default()
        };
        core.handle(EngineMsg::Thermal(ThermalPressure::Serious), t0, &mut w);
        let mut fx = Vec::new();
        core.tick(t0 + secs(30), &mut w, &mut fx);
        assert_eq!(notices(&fx).len(), 1);
        // Cools for a minute, clears, heats again.
        w.thermal = Some(ThermalPressure::Nominal);
        core.handle(
            EngineMsg::Thermal(ThermalPressure::Nominal),
            t0 + secs(40),
            &mut w,
        );
        let mut fx = Vec::new();
        core.tick(t0 + secs(100), &mut w, &mut fx);
        assert!(core.active().is_empty());
        w.thermal = Some(ThermalPressure::Serious);
        core.handle(
            EngineMsg::Thermal(ThermalPressure::Serious),
            t0 + secs(200),
            &mut w,
        );
        let mut fx = Vec::new();
        core.tick(t0 + secs(230), &mut w, &mut fx);
        assert_eq!(core.active().len(), 1);
        assert!(notices(&fx).is_empty(), "inside 15 min of the first notice");
    }

    #[test]
    fn the_default_hotspot_rule_polls_only_the_hotspot_and_fires_after_two_reads() {
        let t0 = Instant::now();
        let mut core = Core::new(AlertSettings::default());
        let hot = Readings {
            hotspot_c: Some(100.0),
            ..Readings::default()
        };
        let mut w = Fake {
            readings: VecDeque::from([hot, hot, hot]),
            culprit: Some(ollama()),
            ..Fake::default()
        };
        // First wake: due at once (startup read).
        assert_eq!(core.wait(t0), Some(Duration::ZERO));
        let mut fx = Vec::new();
        core.tick(t0, &mut w, &mut fx);
        assert_eq!(w.reads.len(), 1);
        assert!(w.reads[0].hotspot_only(), "no CPU load or GPU walk");
        assert_eq!(core.wait(t0), Some(POLL_EVERY));
        core.tick(t0 + secs(30), &mut w, &mut fx);
        assert!(core.active().is_empty());
        core.tick(t0 + secs(60), &mut w, &mut fx);
        assert_eq!(core.active().len(), 1);
        assert_eq!(core.active()[0].rule, AlertRuleId::Hotspot);
        assert_eq!(core.active()[0].level, Level::Stop);
        assert_eq!(notices(&fx)[0].body, "100 °C · ollama");
    }

    #[test]
    fn the_gpu_rule_names_no_process() {
        let t0 = Instant::now();
        let mut core = Core::new(settings(&[AlertRuleId::GpuSustained]));
        let busy = Readings {
            gpu_pct: Some(95.0),
            ..Readings::default()
        };
        let mut w = Fake {
            readings: VecDeque::from(vec![busy; 6]),
            culprit: Some(ollama()),
            ..Fake::default()
        };
        let mut fx = Vec::new();
        for i in 0..5 {
            core.tick(t0 + secs(30 * i), &mut w, &mut fx);
        }
        assert_eq!(core.active().len(), 1);
        assert!(core.active()[0].culprit.is_none());
        assert_eq!(w.primes, 0);
    }

    #[test]
    fn turning_a_firing_rule_off_removes_its_alert() {
        let t0 = Instant::now();
        let mut core = Core::new(settings(&[AlertRuleId::MemoryPressure]));
        let mut w = Fake {
            memory: Some(MemoryPressure::Warning),
            ..Fake::default()
        };
        core.handle(EngineMsg::Memory(MemoryPressure::Warning), t0, &mut w);
        let mut fx = Vec::new();
        core.tick(t0 + secs(60), &mut w, &mut fx);
        assert_eq!(core.active().len(), 1);
        let fx = core.handle(EngineMsg::Settings(settings(&[])), t0 + secs(61), &mut w);
        assert!(core.active().is_empty());
        assert!(matches!(&fx[0], Effect::Publish(v) if v.is_empty()));
        assert_eq!(core.wait(t0 + secs(61)), None);
    }

    #[test]
    fn the_port_rule_baselines_silently_then_notifies_once_and_ends_with_the_listener() {
        let t0 = Instant::now();
        let mut core = Core::new(settings(&[AlertRuleId::WatchedPortTaken]));
        let mut w = Fake {
            watched: vec![5173],
            ..Fake::default()
        };
        let mut fx = Vec::new();
        core.tick(t0, &mut w, &mut fx);
        assert!(fx.is_empty(), "startup scan is a baseline");

        w.listeners = vec![entry(5173, 40, "node")];
        core.tick(t0 + secs(30), &mut w, &mut fx);
        let ns = notices(&fx);
        assert_eq!(ns.len(), 1);
        assert_eq!(
            (ns[0].title.as_str(), ns[0].body.as_str()),
            ("5173 taken", "Vite")
        );
        assert_eq!(ns[0].target, Some(FocusTarget::Port { port: 5173 }));
        assert_eq!(core.active().len(), 1);

        let mut fx = Vec::new();
        core.tick(t0 + secs(60), &mut w, &mut fx);
        assert!(fx.is_empty(), "same incarnation stays quiet");

        w.listeners.clear();
        core.tick(t0 + secs(90), &mut w, &mut fx);
        assert!(core.active().is_empty());
    }

    #[test]
    fn a_closed_port_rule_never_scans() {
        let t0 = Instant::now();
        let mut core = Core::new(settings(&[AlertRuleId::ThermalPressure]));
        let mut w = Fake {
            watched: vec![5173],
            listeners: vec![entry(5173, 1, "node")],
            ..Fake::default()
        };
        let mut fx = Vec::new();
        core.tick(t0 + secs(300), &mut w, &mut fx);
        assert!(fx.is_empty() && w.reads.is_empty());
        assert_eq!(core.wait(t0), None);
    }
}
