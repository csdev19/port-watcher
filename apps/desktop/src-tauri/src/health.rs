//! System health wiring (ADR 0009, 0011): probes what this Mac can report, logs it once, and
//! subscribes to the two default alert signals. Both subscriptions are event-driven: with the
//! panel closed there is no timer and no periodic sampling. Phase 5 turns the logged callbacks
//! into alerts.

use crate::error::AppError;
use crate::machine::dto::{MachineSnapshot, ProcessGroupDto};
use crate::machine::runtime::{Runtime, TopEnv};
use std::sync::{Condvar, Mutex};
use std::time::{Duration, Instant};
use system_health::events::{self, Subscription};
use system_health::infra::mac_sources::MacSources;
use system_health::{Capabilities, Sampler, Sources};
use tauri::{AppHandle, Manager};

/// Capabilities are probed on a background thread (SMC key discovery takes tens of
/// milliseconds), so the commands wait briefly for them. The same probe builds the one sampler
/// the Machine tab reads (one SMC client, one history ring); nothing samples until the panel
/// asks.
pub struct HealthState {
    caps: Mutex<Option<Capabilities>>,
    ready: Condvar,
    subscriptions: Mutex<Vec<Subscription>>,
    runtime: Mutex<Option<Runtime<MacSources>>>,
}

impl HealthState {
    fn new() -> Self {
        Self {
            caps: Mutex::new(None),
            ready: Condvar::new(),
            subscriptions: Mutex::new(Vec::new()),
            runtime: Mutex::new(None),
        }
    }

    fn publish(
        &self,
        caps: Capabilities,
        subs: Vec<Subscription>,
        runtime: Option<Runtime<MacSources>>,
    ) {
        *self.subscriptions.lock().unwrap() = subs;
        *self.runtime.lock().unwrap() = runtime;
        // Capabilities go last: they are the "ready" signal the commands wait on.
        *self.caps.lock().unwrap() = Some(caps);
        self.ready.notify_all();
    }

    /// Runs `f` on the Machine runtime, waiting up to 2 s for the probe.
    fn with_runtime<R>(
        &self,
        f: impl FnOnce(&mut Runtime<MacSources>) -> R,
    ) -> Result<R, AppError> {
        let _ = self.capabilities();
        let mut guard = self
            .runtime
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        match guard.as_mut() {
            Some(rt) => Ok(f(rt)),
            None => Err(AppError::Internal("system health is not ready".into())),
        }
    }

    /// The gauges and recent history. Samples only when the cached reading is 900 ms old.
    pub fn machine_snapshot(&self, window_s: Option<u32>) -> Result<MachineSnapshot, AppError> {
        self.with_runtime(|rt| rt.snapshot(Instant::now(), window_s))
    }

    /// Top processes grouped by app bundle. One full process walk per call.
    pub fn top_processes(&self, limit: Option<u8>) -> Result<Vec<ProcessGroupDto>, AppError> {
        let home = std::env::var("HOME").ok();
        let env = TopEnv {
            my_uid: nix::unistd::getuid().as_raw(),
            self_pid: std::process::id(),
            home: home.as_deref(),
        };
        self.with_runtime(|rt| {
            let started = Instant::now();
            let rows = rt.top(started, limit, &env);
            log::debug!(
                "system-health: top walk took {:?} ({} rows)",
                started.elapsed(),
                rows.len()
            );
            rows
        })
    }

    /// The probed capabilities; all `false` if the probe has not finished after 2 s.
    pub fn capabilities(&self) -> Capabilities {
        let guard = self.caps.lock().unwrap();
        let (guard, _) = self
            .ready
            .wait_timeout_while(guard, Duration::from_secs(2), |c| c.is_none())
            .unwrap();
        guard.clone().unwrap_or(Capabilities {
            smc: false,
            sensors: 0,
            gpu: false,
            thermal: false,
            thermal_events: false,
            memory_events: false,
            system_power: false,
            per_process_energy: false,
        })
    }
}

pub fn init(app: &AppHandle) {
    app.manage(HealthState::new());
    let handle = app.clone();
    let spawned = std::thread::Builder::new()
        .name("system-health-init".into())
        .spawn(move || {
            let sources = MacSources::new();
            let caps = sources.capabilities();
            log::info!("system-health: {}", caps.summary());
            let info = sources.machine();
            let runtime = Runtime::new(Sampler::new(sources), info, caps.clone());

            let mut subs = Vec::new();
            if let Some((level, raw)) = events::current_thermal() {
                log::info!(
                    "system-health: thermal pressure {} (raw {raw})",
                    level.label()
                );
            }
            match events::subscribe_thermal(|level, raw| {
                log::info!(
                    "system-health: thermal pressure -> {} (raw {raw})",
                    level.label()
                );
            }) {
                Ok(s) => subs.push(s),
                Err(e) => log::warn!("system-health: thermal subscription unavailable: {e}"),
            }
            if let Some(level) = events::current_memory() {
                log::info!("system-health: memory pressure {}", level.label());
            }
            match events::subscribe_memory(|level| {
                log::info!("system-health: memory pressure -> {}", level.label());
            }) {
                Ok(s) => subs.push(s),
                Err(e) => log::warn!("system-health: memory subscription unavailable: {e}"),
            }
            handle
                .state::<HealthState>()
                .publish(caps, subs, Some(runtime));
        });
    if let Err(e) = spawned {
        log::warn!("system-health: could not start the probe thread: {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn caps() -> Capabilities {
        Capabilities {
            smc: true,
            sensors: 7,
            gpu: true,
            thermal: true,
            thermal_events: true,
            memory_events: true,
            system_power: false,
            per_process_energy: true,
        }
    }

    #[test]
    fn capabilities_serialize_camel_case() {
        let json = serde_json::to_value(caps()).unwrap();
        for key in [
            "smc",
            "sensors",
            "gpu",
            "thermal",
            "thermalEvents",
            "memoryEvents",
            "systemPower",
            "perProcessEnergy",
        ] {
            assert!(json.get(key).is_some(), "missing {key}");
        }
    }

    #[test]
    fn commands_report_not_ready_when_no_runtime_was_published() {
        let state = HealthState::new();
        state.publish(caps(), Vec::new(), None);
        assert!(state.machine_snapshot(None).is_err());
        assert!(state.top_processes(None).is_err());
    }

    #[test]
    fn capabilities_wait_returns_published_value() {
        let state = HealthState::new();
        state.publish(caps(), Vec::new(), None);
        assert_eq!(state.capabilities(), caps());
    }

    /// Real machine: our own process is never offered a kill button.
    #[test]
    #[ignore = "reads the real process table; run with --ignored on a Mac"]
    fn own_process_is_never_killable() {
        let sources = MacSources::new();
        let (caps, info) = (sources.capabilities(), sources.machine());
        let state = HealthState::new();
        state.publish(
            caps.clone(),
            Vec::new(),
            Some(Runtime::new(Sampler::new(sources), info, caps)),
        );
        let _ = state.top_processes(Some(20)).unwrap();
        std::thread::sleep(Duration::from_secs(2));
        let rows = state.top_processes(Some(20)).unwrap();
        assert!(!rows.is_empty());
        let me = std::process::id();
        for r in rows {
            if r.target.is_some_and(|t| t.pid == me) {
                assert!(!r.killable, "own process offered a kill: {}", r.name);
            }
        }
    }
}
