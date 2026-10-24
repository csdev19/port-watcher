//! Alerts (ADR 0011, ADR 0013). Each context emits its own events in its own words: System
//! health emits `HealthTransition`s, Ports emits `PortTaken`. This app-level module maps both
//! into `ActiveAlert`s and owns delivery: the engine thread, cooldowns and caps, the tray
//! signal, native notifications and the band the panel draws. There is no generic rule engine.

pub mod app;
pub mod engine;
pub mod notifier;
pub mod policy;
pub mod tray_signal;

use std::sync::mpsc::Sender;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use system_health::{HealthRuleId, Level};

use crate::ports::watch::PortTaken;

/// The six fixed rules. On/off is the only setting; thresholds are constants in the crate.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AlertRuleId {
    ThermalPressure,
    Hotspot,
    MemoryPressure,
    CpuSustained,
    GpuSustained,
    WatchedPortTaken,
}

impl AlertRuleId {
    pub const ALL: [AlertRuleId; 6] = [
        AlertRuleId::ThermalPressure,
        AlertRuleId::Hotspot,
        AlertRuleId::MemoryPressure,
        AlertRuleId::CpuSustained,
        AlertRuleId::GpuSustained,
        AlertRuleId::WatchedPortTaken,
    ];

    /// The key in `settings.json` (mirrored by `SETTINGS_DEFAULTS` in the renderer).
    pub fn setting_key(self) -> &'static str {
        match self {
            Self::ThermalPressure => "alertThermalPressure",
            Self::Hotspot => "alertHotspot",
            Self::MemoryPressure => "alertMemoryPressure",
            Self::CpuSustained => "alertCpuSustained",
            Self::GpuSustained => "alertGpuSustained",
            Self::WatchedPortTaken => "alertWatchedPortTaken",
        }
    }

    pub fn default_on(self) -> bool {
        matches!(
            self,
            Self::ThermalPressure | Self::Hotspot | Self::MemoryPressure
        )
    }

    pub fn title(self) -> &'static str {
        match self {
            Self::ThermalPressure => "Thermal pressure Serious",
            Self::Hotspot => "CPU hotspot over 95 °C",
            Self::MemoryPressure => "Memory pressure Warning",
            Self::CpuSustained => "CPU over 80% for 2 min",
            Self::GpuSustained => "GPU over 90% for 2 min",
            Self::WatchedPortTaken => "Watched port taken",
        }
    }

    pub fn sub(self) -> &'static str {
        match self {
            Self::ThermalPressure => "macOS is slowing the chip down. Waits 30 s, then alerts.",
            Self::Hotspot => {
                "Hottest core at 95 °C or more for a minute, even if macOS says nominal."
            }
            Self::MemoryPressure => "macOS is short on memory. Waits 1 min, then alerts.",
            Self::CpuSustained => "Whole-machine load, checked every 30 s while this is on.",
            Self::GpuSustained => "Graphics load, checked every 30 s while this is on.",
            Self::WatchedPortTaken => "Another program starts listening on a port you watch.",
        }
    }

    pub fn from_health(rule: HealthRuleId) -> Self {
        match rule {
            HealthRuleId::ThermalPressure => Self::ThermalPressure,
            HealthRuleId::Hotspot => Self::Hotspot,
            HealthRuleId::MemoryPressure => Self::MemoryPressure,
            HealthRuleId::CpuSustained => Self::CpuSustained,
            HealthRuleId::GpuSustained => Self::GpuSustained,
        }
    }

    fn index(self) -> usize {
        Self::ALL
            .iter()
            .position(|r| *r == self)
            .expect("every rule is in ALL")
    }
}

/// Which rules are on. Read from `settings.json`; a missing or malformed value falls back to the
/// rule's default (like `update::policy::auto_check_enabled`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AlertSettings {
    enabled: [bool; 6],
}

impl Default for AlertSettings {
    fn default() -> Self {
        Self {
            enabled: AlertRuleId::ALL.map(AlertRuleId::default_on),
        }
    }
}

impl AlertSettings {
    pub fn from_store(get: impl Fn(&str) -> Option<serde_json::Value>) -> Self {
        let mut s = Self::default();
        for rule in AlertRuleId::ALL {
            if let Some(serde_json::Value::Bool(on)) = get(rule.setting_key()) {
                s.enabled[rule.index()] = on;
            }
        }
        s
    }

    pub fn is_enabled(&self, rule: AlertRuleId) -> bool {
        self.enabled[rule.index()]
    }

    pub fn with(mut self, rule: AlertRuleId, on: bool) -> Self {
        self.enabled[rule.index()] = on;
        self
    }

    pub fn health_rules(&self) -> Vec<HealthRuleId> {
        HealthRuleId::ALL
            .into_iter()
            .filter(|r| self.is_enabled(AlertRuleId::from_health(*r)))
            .collect()
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlertRule {
    pub id: AlertRuleId,
    pub title: String,
    pub sub: String,
    pub enabled: bool,
    pub firing: bool,
}

/// Where a click on a notification or the band's row should land in the panel.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum FocusTarget {
    #[serde(rename_all = "camelCase")]
    Process {
        pid: u32,
        started_at: u64,
    },
    Port {
        port: u16,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Culprit {
    pub pid: u32,
    pub started_at: u64,
    pub name: String,
    /// From the same Rust policy as the kill itself (ADR 0006).
    pub killable: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveAlert {
    /// `health:thermalPressure` or `ports:5173`.
    pub id: String,
    pub rule: AlertRuleId,
    pub level: Level,
    pub title: String,
    /// What the rule saw, for example "97 °C" or "Vite".
    pub reading: String,
    pub culprit: Option<Culprit>,
    pub since_epoch_ms: u64,
    pub target: Option<FocusTarget>,
}

impl ActiveAlert {
    pub fn health(
        rule: AlertRuleId,
        level: Level,
        reading: String,
        culprit: Option<Culprit>,
        since_epoch_ms: u64,
    ) -> Self {
        let target = culprit.as_ref().map(|c| FocusTarget::Process {
            pid: c.pid,
            started_at: c.started_at,
        });
        Self {
            id: format!("health:{}", rule_key(rule)),
            rule,
            level,
            title: rule.title().to_string(),
            reading,
            culprit,
            since_epoch_ms,
            target,
        }
    }

    pub fn port(taken: &PortTaken, since_epoch_ms: u64) -> Self {
        Self {
            id: format!("ports:{}", taken.port),
            rule: AlertRuleId::WatchedPortTaken,
            level: Level::Watch,
            title: format!("{} taken", taken.port),
            reading: taken.label.clone(),
            culprit: Some(Culprit {
                pid: taken.pid,
                started_at: taken.started_at,
                name: taken.label.clone(),
                // The Ports tab decides whether the row can be killed; the band never offers it.
                killable: false,
            }),
            since_epoch_ms,
            target: Some(FocusTarget::Port { port: taken.port }),
        }
    }
}

fn rule_key(rule: AlertRuleId) -> String {
    let json = serde_json::to_value(rule).unwrap_or_default();
    json.as_str().unwrap_or("unknown").to_string()
}

/// What the engine thread is told. Everything it reacts to arrives as one of these.
pub enum EngineMsg {
    Thermal(system_health::ThermalPressure),
    Memory(system_health::MemoryPressure),
    /// A reading the panel's 1 Hz sampling produced; the rules use it as if they had polled.
    Readings(system_health::Readings),
    Settings(AlertSettings),
}

/// Managed state: the engine's inbox and the alerts it currently shows.
pub struct AlertsState {
    pub tx: Sender<EngineMsg>,
    pub active: Mutex<Vec<ActiveAlert>>,
    pub settings: Mutex<AlertSettings>,
}

pub const ALERTS_CHANGED_EVENT: &str = "alerts-changed";
pub const ALERT_FOCUS_EVENT: &str = "alert-focus";

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn defaults_are_the_three_event_and_hotspot_rules() {
        let s = AlertSettings::default();
        let on: Vec<_> = AlertRuleId::ALL
            .into_iter()
            .filter(|r| s.is_enabled(*r))
            .collect();
        assert_eq!(
            on,
            [
                AlertRuleId::ThermalPressure,
                AlertRuleId::Hotspot,
                AlertRuleId::MemoryPressure
            ]
        );
    }

    #[test]
    fn store_reader_uses_defaults_for_missing_and_garbage_values() {
        let s = AlertSettings::from_store(|k| match k {
            "alertThermalPressure" => Some(json!(false)),
            "alertCpuSustained" => Some(json!(true)),
            "alertMemoryPressure" => Some(json!("yes")),
            "alertHotspot" => Some(json!(null)),
            _ => None,
        });
        assert!(!s.is_enabled(AlertRuleId::ThermalPressure));
        assert!(s.is_enabled(AlertRuleId::CpuSustained));
        assert!(
            s.is_enabled(AlertRuleId::MemoryPressure),
            "garbage -> default on"
        );
        assert!(s.is_enabled(AlertRuleId::Hotspot));
        assert!(!s.is_enabled(AlertRuleId::GpuSustained));
        assert!(!s.is_enabled(AlertRuleId::WatchedPortTaken));
    }

    #[test]
    fn health_rules_follow_the_enabled_set() {
        let s = AlertSettings::default().with(AlertRuleId::CpuSustained, true);
        assert_eq!(
            s.health_rules(),
            [
                HealthRuleId::ThermalPressure,
                HealthRuleId::Hotspot,
                HealthRuleId::MemoryPressure,
                HealthRuleId::CpuSustained
            ]
        );
    }

    #[test]
    fn setting_keys_match_the_renderer() {
        let keys: Vec<_> = AlertRuleId::ALL.map(AlertRuleId::setting_key).to_vec();
        assert_eq!(
            keys,
            [
                "alertThermalPressure",
                "alertHotspot",
                "alertMemoryPressure",
                "alertCpuSustained",
                "alertGpuSustained",
                "alertWatchedPortTaken"
            ]
        );
    }

    #[test]
    fn active_alert_json_shape_matches_the_typescript_types() {
        let a = ActiveAlert::health(
            AlertRuleId::ThermalPressure,
            Level::Stop,
            "Serious".into(),
            Some(Culprit {
                pid: 321,
                started_at: 1_757_000_000,
                name: "ollama".into(),
                killable: true,
            }),
            1_000,
        );
        assert_eq!(
            serde_json::to_value(&a).unwrap(),
            json!({
                "id": "health:thermalPressure",
                "rule": "thermalPressure",
                "level": "stop",
                "title": "Thermal pressure Serious",
                "reading": "Serious",
                "culprit": {"pid": 321, "startedAt": 1_757_000_000u64, "name": "ollama", "killable": true},
                "sinceEpochMs": 1000,
                "target": {"kind": "process", "pid": 321, "startedAt": 1_757_000_000u64}
            })
        );
        let p = ActiveAlert::port(
            &PortTaken {
                port: 5173,
                pid: 9,
                started_at: 5,
                label: "Vite".into(),
            },
            2_000,
        );
        let v = serde_json::to_value(&p).unwrap();
        assert_eq!(v["id"], "ports:5173");
        assert_eq!(v["title"], "5173 taken");
        assert_eq!(v["target"], json!({"kind": "port", "port": 5173}));
        assert_eq!(v["culprit"]["killable"], false);
    }
}
