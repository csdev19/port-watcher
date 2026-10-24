//! System health wiring (ADR 0009, 0011): probes what this Mac can report, logs it once, and
//! subscribes to the two default alert signals. Both subscriptions are event-driven: with the
//! panel closed there is no timer and no periodic sampling. Phase 5 turns the logged callbacks
//! into alerts.

use std::sync::{Condvar, Mutex};
use std::time::Duration;
use system_health::events::{self, Subscription};
use system_health::infra::mac_sources::MacSources;
use system_health::{Capabilities, Sources};
use tauri::{AppHandle, Manager};

/// Capabilities are probed on a background thread (SMC key discovery takes tens of
/// milliseconds), so the command waits briefly for them.
pub struct HealthState {
    caps: Mutex<Option<Capabilities>>,
    ready: Condvar,
    subscriptions: Mutex<Vec<Subscription>>,
}

impl HealthState {
    fn new() -> Self {
        Self {
            caps: Mutex::new(None),
            ready: Condvar::new(),
            subscriptions: Mutex::new(Vec::new()),
        }
    }

    fn publish(&self, caps: Capabilities, subs: Vec<Subscription>) {
        *self.subscriptions.lock().unwrap() = subs;
        *self.caps.lock().unwrap() = Some(caps);
        self.ready.notify_all();
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
            system_processes: false,
        })
    }
}

pub fn init(app: &AppHandle) {
    app.manage(HealthState::new());
    let handle = app.clone();
    let spawned = std::thread::Builder::new()
        .name("system-health-init".into())
        .spawn(move || {
            let caps = MacSources::new().capabilities();
            log::info!("system-health: {}", caps.summary());

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
            handle.state::<HealthState>().publish(caps, subs);
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
            system_processes: true,
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
            "systemProcesses",
        ] {
            assert!(json.get(key).is_some(), "missing {key}");
        }
    }

    #[test]
    fn capabilities_wait_returns_published_value() {
        let state = HealthState::new();
        state.publish(caps(), Vec::new());
        assert_eq!(state.capabilities(), caps());
    }
}
