//! The IPC types of the `thermal_*` commands. Field names and string enums
//! are the contract the renderer codes against (spec "Commands and types").

use serde::Serialize;

use super::reading::{band_for, Reading, ThermalBand, ThermalState};
use super::store::{Bucket, Day, Peak, PeakProcess};

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThermalReadingDto {
    pub avg_c: f64,
    pub max_c: f64,
    pub sensors: usize,
    pub state: ThermalState,
    pub band: ThermalBand,
    /// Epoch seconds.
    pub at: i64,
    /// 7-day average, `null` until history exists.
    pub baseline_c: Option<f64>,
}

impl ThermalReadingDto {
    pub fn new(r: &Reading, baseline_c: Option<f64>) -> Self {
        ThermalReadingDto {
            avg_c: r.avg_c,
            max_c: r.max_c,
            sensors: r.sensors,
            state: r.state,
            band: band_for(r.avg_c),
            at: r.at_s,
            baseline_c,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThermalBucketDto {
    pub start_s: i64,
    pub min_c: f64,
    pub avg_c: f64,
    pub max_avg_c: f64,
    pub max_c: f64,
    pub worst_state: ThermalState,
    pub samples: i64,
}

impl From<Bucket> for ThermalBucketDto {
    fn from(b: Bucket) -> Self {
        ThermalBucketDto {
            start_s: b.start_s,
            min_c: b.min_c,
            avg_c: b.avg_c,
            max_avg_c: b.max_avg_c,
            max_c: b.max_c,
            worst_state: ThermalState::from_i64(b.worst_state),
            samples: b.samples,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThermalPeakDto {
    pub id: i64,
    pub at_s: i64,
    pub avg_c: f64,
    pub max_c: f64,
    pub state: ThermalState,
    pub processes: Vec<PeakProcess>,
}

impl From<Peak> for ThermalPeakDto {
    fn from(p: Peak) -> Self {
        ThermalPeakDto {
            id: p.id.unwrap_or_default(),
            at_s: p.at_s,
            avg_c: p.avg_c,
            max_c: p.max_c,
            state: ThermalState::from_i64(p.state),
            processes: p.processes,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThermalHistoryDto {
    pub available: bool,
    pub buckets: Vec<ThermalBucketDto>,
    pub peaks: Vec<ThermalPeakDto>,
    /// `store::Day` already serializes to the contract's `ThermalDay`.
    pub days: Vec<Day>,
}

impl ThermalHistoryDto {
    pub fn unavailable() -> Self {
        ThermalHistoryDto {
            available: false,
            buckets: Vec::new(),
            peaks: Vec::new(),
            days: Vec::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn reading_serializes_to_the_ts_contract() {
        let r = Reading {
            avg_c: 62.5,
            max_c: 70.0,
            sensors: 6,
            state: ThermalState::Fair,
            at_s: 1_762_000_000,
        };
        assert_eq!(
            serde_json::to_value(ThermalReadingDto::new(&r, None)).unwrap(),
            json!({"avgC": 62.5, "maxC": 70.0, "sensors": 6, "state": "fair",
                   "band": "normal", "at": 1_762_000_000, "baselineC": null})
        );
    }

    #[test]
    fn history_serializes_states_as_strings() {
        let h = ThermalHistoryDto {
            available: true,
            buckets: vec![Bucket {
                start_s: 300,
                min_c: 1.0,
                avg_c: 2.0,
                max_avg_c: 3.0,
                max_c: 4.0,
                worst_state: 2,
                samples: 5,
            }
            .into()],
            peaks: vec![Peak {
                id: Some(9),
                at_s: 10,
                avg_c: 90.0,
                max_c: 96.0,
                state: 3,
                processes: vec![PeakProcess {
                    pid: 1,
                    name: "vite".into(),
                    cpu: 80.0,
                    ports: vec![5173],
                }],
            }
            .into()],
            days: vec![],
        };
        let v = serde_json::to_value(h).unwrap();
        assert_eq!(v["buckets"][0]["worstState"], "serious");
        assert_eq!(v["buckets"][0]["startS"], 300);
        assert_eq!(v["peaks"][0]["state"], "critical");
        assert_eq!(v["peaks"][0]["atS"], 10);
        assert_eq!(v["peaks"][0]["processes"][0]["ports"], json!([5173]));
    }

    #[test]
    fn unavailable_history_is_empty() {
        let v = serde_json::to_value(ThermalHistoryDto::unavailable()).unwrap();
        assert_eq!(
            v,
            json!({"available": false, "buckets": [], "peaks": [], "days": []})
        );
    }
}
