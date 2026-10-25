//! Wiring: the production `World`, the engine thread, and what the commands read and change.

use std::sync::mpsc;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use system_health::{MemoryPressure, Needs, Readings, ThermalPressure};
use tauri::{AppHandle, Emitter, Manager};

use super::engine::{self, Attribution, Core, Effect, World};
use super::{
    notifier, tray_signal, ActiveAlert, AlertRule, AlertRuleId, AlertSettings, AlertsState,
    Culprit, EngineMsg, ALERTS_CHANGED_EVENT,
};
use crate::error::AppError;
use crate::health::HealthState;
use crate::machine::runtime::Rank;
use crate::ports::enrich::enrich;
use crate::ports::models::PortEntry;
use crate::ports::source::raw_ports;
use crate::ports::watch::watched_ports_from_value;

const STORE_FILE: &str = "settings.json";

pub struct AppWorld {
    app: AppHandle,
}

impl World for AppWorld {
    fn thermal(&self) -> Option<ThermalPressure> {
        system_health::events::current_thermal().map(|(p, _)| p)
    }

    fn memory(&self) -> Option<MemoryPressure> {
        system_health::events::current_memory()
    }

    fn panel_visible(&self) -> bool {
        self.app
            .get_webview_window("main")
            .and_then(|w| w.is_visible().ok())
            .unwrap_or(false)
    }

    fn read(&mut self, needs: Needs, max_age: Duration) -> Option<Readings> {
        self.app
            .state::<HealthState>()
            .background_readings(needs, max_age)
    }

    fn prime(&mut self) {
        self.app.state::<HealthState>().prime_attribution();
    }

    fn culprit(&mut self, by: Attribution) -> Option<Culprit> {
        let rank = match by {
            Attribution::Cpu => Rank::Cpu,
            Attribution::Memory => Rank::Memory,
            Attribution::None => return None,
        };
        let row = self.app.state::<HealthState>().culprit(rank)?;
        let target = row.target?;
        Some(Culprit {
            pid: target.pid,
            started_at: target.started_at,
            name: row.name,
            killable: row.killable,
        })
    }

    fn watched_ports(&self) -> Vec<u16> {
        use tauri_plugin_store::StoreExt;
        let stored = self
            .app
            .store(STORE_FILE)
            .ok()
            .and_then(|s| s.get("favourites"));
        watched_ports_from_value(stored.as_ref())
    }

    fn listeners(&mut self, ports: &[u16]) -> Vec<PortEntry> {
        let Ok(raw) = raw_ports() else {
            return Vec::new();
        };
        enrich(
            raw.into_iter()
                .filter(|r| ports.contains(&r.port))
                .collect(),
        )
    }

    fn epoch_ms(&self) -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| d.as_millis() as u64)
    }
}

pub fn stored_settings(app: &AppHandle) -> AlertSettings {
    use tauri_plugin_store::StoreExt;
    match app.store(STORE_FILE) {
        Ok(store) => AlertSettings::from_store(|k| store.get(k)),
        Err(_) => AlertSettings::default(),
    }
}

/// Starts the engine thread. Call from `setup` after `notifier::init` and before
/// `health::init`, which feeds it the pressure subscriptions.
pub fn start(app: &AppHandle) {
    let settings = stored_settings(app);
    let (tx, rx) = mpsc::channel();
    app.manage(AlertsState {
        tx,
        active: Mutex::new(Vec::new()),
        settings: Mutex::new(settings),
    });
    let handle = app.clone();
    let spawned = std::thread::Builder::new()
        .name("chapay-alerts".into())
        .spawn(move || {
            engine::set_utility_qos();
            let world = AppWorld {
                app: handle.clone(),
            };
            engine::run(Core::new(settings), rx, world, |fx| apply(&handle, fx));
        });
    if let Err(e) = spawned {
        log::warn!("alerts: could not start the engine thread ({e})");
    }
}

fn apply(app: &AppHandle, effects: Vec<Effect>) {
    for fx in effects {
        match fx {
            Effect::Publish(alerts) => publish(app, alerts),
            Effect::Notify(notice) => notifier::show(app, notice),
        }
    }
}

fn publish(app: &AppHandle, alerts: Vec<ActiveAlert>) {
    if let Some(state) = app.try_state::<AlertsState>() {
        *state.active.lock().unwrap() = alerts.clone();
    }
    tray_signal::apply(app, tray_signal::tray_variant(alerts.len()));
    let _ = app.emit(ALERTS_CHANGED_EVENT, &alerts);
}

pub fn list_rules(app: &AppHandle) -> Vec<AlertRule> {
    let Some(state) = app.try_state::<AlertsState>() else {
        return Vec::new();
    };
    let settings = *state.settings.lock().unwrap();
    let active = state.active.lock().unwrap();
    AlertRuleId::ALL
        .into_iter()
        .map(|id| AlertRule {
            id,
            title: id.title().to_string(),
            sub: id.sub().to_string(),
            enabled: settings.is_enabled(id),
            firing: active.iter().any(|a| a.rule == id),
        })
        .collect()
}

pub fn set_rule_enabled(app: &AppHandle, rule: AlertRuleId, enabled: bool) -> Result<(), AppError> {
    let state = app
        .try_state::<AlertsState>()
        .ok_or_else(|| AppError::Internal("alerts are not running".into()))?;
    let next = {
        let mut settings = state.settings.lock().unwrap();
        *settings = settings.with(rule, enabled);
        *settings
    };
    state
        .tx
        .send(EngineMsg::Settings(next))
        .map_err(|e| AppError::Internal(e.to_string()))
}

pub fn active_alerts(app: &AppHandle) -> Vec<ActiveAlert> {
    app.try_state::<AlertsState>()
        .map(|s| s.active.lock().unwrap().clone())
        .unwrap_or_default()
}

/// Forwards the panel's newest reading to the engine (called after each Machine snapshot).
pub fn forward_readings(app: &AppHandle) {
    let (Some(state), Some(readings)) = (
        app.try_state::<AlertsState>(),
        app.state::<HealthState>().last_readings(),
    ) else {
        return;
    };
    let _ = state.tx.send(EngineMsg::Readings(readings));
}
