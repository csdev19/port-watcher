//! JSON output: camelCase, one object per line with `--watch` (NDJSON).

use crate::domain::{ProcessUsage, Reading, Sample, Verdict};
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HeatOut<'a> {
    #[serde(flatten)]
    sample: &'a Sample,
    verdict: &'a Verdict,
}

pub fn heat(sample: &Sample, verdict: &Verdict) -> String {
    serde_json::to_string(&HeatOut { sample, verdict }).expect("sample serializes")
}

pub fn top(rows: &[ProcessUsage]) -> String {
    serde_json::to_string(rows).expect("usage serializes")
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SensorOut {
    pub key: String,
    pub group: &'static str,
    pub validity: &'static str,
    pub celsius: f32,
}

pub fn sensor_rows(readings: &[Reading]) -> Vec<SensorOut> {
    readings
        .iter()
        .map(|r| SensorOut {
            key: r.key.as_string(),
            group: super::human::group_label(r.group()),
            validity: super::human::validity_label(r.validity()),
            celsius: r.celsius,
        })
        .collect()
}

pub fn sensors(readings: &[Reading]) -> String {
    serde_json::to_string(&sensor_rows(readings)).expect("sensors serialize")
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EventOut<'a> {
    at: &'a str,
    signal: &'a str,
    level: &'a str,
}

pub fn event(at: &str, signal: &str, level: &str) -> String {
    serde_json::to_string(&EventOut { at, signal, level }).expect("event serializes")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::memory::GB;
    use crate::domain::{
        CpuLoad, Fan, Heat, Level, Memory, MemoryPressure, Reason, ThermalPressure,
    };

    #[test]
    fn heat_json_is_camel_case_with_a_verdict() {
        let s = Sample {
            taken_at_ms: 5,
            cpu: Some(CpuLoad {
                total_pct: 1.0,
                cores: vec![],
            }),
            gpu_pct: None,
            heat: Some(Heat {
                cpu_max_c: 1.0,
                cpu_avg_c: 1.0,
                gpu_max_c: None,
                sensors_used: 1,
                sensors_gated: 2,
            }),
            fan: Some(Fan {
                rpm: 1.0,
                max_rpm: 2.0,
            }),
            power: None,
            thermal: Some(ThermalPressure::Fair),
            thermal_raw: Some(1),
            memory: Memory {
                total_bytes: GB as u64,
                used_bytes: 1,
                compressed_bytes: 0,
                swap_bytes: 0,
                free_pct: 5,
                pressure: MemoryPressure::Warning,
            },
        };
        let v = Verdict {
            level: Level::Watch,
            reasons: vec![Reason::ThermalPressure(ThermalPressure::Fair)],
        };
        let out: serde_json::Value = serde_json::from_str(&heat(&s, &v)).unwrap();
        assert_eq!(out["takenAtMs"], 5);
        assert_eq!(out["thermalRaw"], 1);
        assert_eq!(out["thermal"], "fair");
        assert_eq!(out["heat"]["cpuMaxC"], 1.0);
        assert_eq!(out["heat"]["sensorsGated"], 2);
        assert_eq!(out["memory"]["freePct"], 5);
        assert_eq!(out["memory"]["pressure"], "warning");
        assert_eq!(out["verdict"]["level"], "watch");
        assert_eq!(out["verdict"]["reasons"][0]["thermalPressure"], "fair");
        assert!(out.get("gpuPct").is_some_and(|v| v.is_null()));
        assert!(!heat(&s, &v).contains('\n'));
    }

    #[test]
    fn event_json_shape() {
        let out: serde_json::Value =
            serde_json::from_str(&event("t", "thermal", "serious")).unwrap();
        assert_eq!(
            out,
            serde_json::json!({"at":"t","signal":"thermal","level":"serious"})
        );
    }
}
