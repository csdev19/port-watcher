//! Wire types for the Machine tab. camelCase, mirrored by `src/lib/machine-types.ts`.

use serde::Serialize;
use system_health::Level;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum GaugeId {
    Cpu,
    Gpu,
    Heat,
    Memory,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum GaugeUnit {
    #[serde(rename = "%")]
    Percent,
    #[serde(rename = "°C")]
    Celsius,
    #[serde(rename = "level")]
    Level,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GaugeDto {
    pub id: GaugeId,
    pub level: Level,
    /// Main figure: "34%", "Fair", "18.2 / 24 GB", or "n/a".
    pub value: String,
    /// A second figure shown beside the value, for example the Heat hotspot "115 °C".
    pub extra: Option<String>,
    /// Why this gauge reads what it reads.
    pub driver: String,
    /// The same numbers draw the sparkline lines and the band words.
    pub warn: Option<f32>,
    pub stop: Option<f32>,
    pub min: f32,
    pub max: f32,
    pub unit: GaugeUnit,
    pub available: bool,
    pub unavailable_reason: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryPoint {
    pub at_ms: u64,
    pub cpu: Option<f32>,
    pub gpu: Option<f32>,
    pub heat: Option<f32>,
    /// Thermal pressure as 0 (nominal) to 3 (critical).
    pub heat_level: Option<u8>,
    pub mem_used_pct: f32,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MachineSummary {
    pub chip: String,
    pub cores: u16,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerdictDto {
    pub level: Level,
    pub reasons: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MachineSnapshot {
    pub machine: MachineSummary,
    pub interval_ms: u32,
    pub gauges: Vec<GaugeDto>,
    pub history: Vec<HistoryPoint>,
    pub verdict: VerdictDto,
    pub sampled_at_ms: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LockReason {
    System,
    OtherUser,
    #[serde(rename = "self")]
    SelfProcess,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KillTarget {
    pub pid: u32,
    pub started_at: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessGroupDto {
    pub key: String,
    pub name: String,
    pub sub: String,
    /// Share of the whole machine (0 to 100), not of one core.
    pub cpu_pct: f32,
    pub mem_bytes: u64,
    pub member_count: u32,
    /// The one process the row's kill button signals.
    pub target: Option<KillTarget>,
    pub target_is_main: bool,
    /// Name of the target process: the app ("Cursor") for a main process, not the heaviest helper.
    pub target_name: String,
    pub killable: bool,
    pub lock_reason: Option<LockReason>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn gauge_serializes_camel_case_with_unit_symbols() {
        let g = GaugeDto {
            id: GaugeId::Heat,
            level: Level::Watch,
            value: "Fair".into(),
            extra: Some("85 °C".into()),
            driver: "d".into(),
            warn: Some(80.0),
            stop: None,
            min: 30.0,
            max: 120.0,
            unit: GaugeUnit::Celsius,
            available: true,
            unavailable_reason: None,
        };
        let v = serde_json::to_value(g).unwrap();
        assert_eq!(v["id"], "heat");
        assert_eq!(v["level"], "watch");
        assert_eq!(v["unit"], "°C");
        assert_eq!(v["stop"], json!(null));
        assert_eq!(v["unavailableReason"], json!(null));
        assert_eq!(serde_json::to_value(GaugeUnit::Percent).unwrap(), "%");
        assert_eq!(serde_json::to_value(GaugeUnit::Level).unwrap(), "level");
    }

    #[test]
    fn snapshot_and_group_keys_are_camel_case() {
        let snap = MachineSnapshot {
            machine: MachineSummary {
                chip: "Apple M4 Pro".into(),
                cores: 12,
            },
            interval_ms: 1000,
            gauges: vec![],
            history: vec![HistoryPoint {
                at_ms: 1,
                cpu: None,
                gpu: None,
                heat: None,
                heat_level: Some(1),
                mem_used_pct: 50.0,
            }],
            verdict: VerdictDto {
                level: Level::Ok,
                reasons: vec![],
            },
            sampled_at_ms: 2,
        };
        let v = serde_json::to_value(snap).unwrap();
        for k in [
            "machine",
            "intervalMs",
            "gauges",
            "history",
            "verdict",
            "sampledAtMs",
        ] {
            assert!(v.get(k).is_some(), "missing {k}");
        }
        assert_eq!(v["history"][0]["heatLevel"], 1);
        assert_eq!(v["history"][0]["memUsedPct"], 50.0);

        let g = ProcessGroupDto {
            key: "k".into(),
            name: "n".into(),
            sub: "s".into(),
            cpu_pct: 1.0,
            mem_bytes: 2,
            member_count: 3,
            target: Some(KillTarget {
                pid: 4,
                started_at: 5,
            }),
            target_is_main: true,
            target_name: "Cursor".into(),
            killable: false,
            lock_reason: Some(LockReason::SelfProcess),
        };
        let v = serde_json::to_value(g).unwrap();
        assert_eq!(v["lockReason"], "self");
        assert_eq!(v["target"]["startedAt"], 5);
        assert_eq!(v["targetIsMain"], true);
        assert_eq!(v["targetName"], "Cursor");
        assert_eq!(v["memberCount"], 3);
        assert_eq!(
            serde_json::to_value(LockReason::OtherUser).unwrap(),
            "otherUser"
        );
    }
}
