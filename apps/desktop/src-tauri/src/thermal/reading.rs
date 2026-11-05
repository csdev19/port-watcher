//! One temperature reading: the die sensors macOS exposes, the thermal
//! pressure level macOS reports itself, and the context bands we label the
//! average with. The pure parts (filtering, bands, state mapping) are tested;
//! the live reads are thin wrappers over `sysinfo` and `NSProcessInfo`.

use serde::Serialize;
use sysinfo::Components;

/// Below this a sensor is reporting garbage. Apple Silicon exposes dead
/// sensors as about -9201 °C, which would wreck any average they enter.
pub const MIN_PLAUSIBLE_C: f64 = 1.0;

/// Above this a sensor is reporting garbage; no chip is alive at 130 °C.
pub const MAX_PLAUSIBLE_C: f64 = 130.0;

/// macOS's own thermal pressure level (`NSProcessInfo.thermalState`). It is
/// the only official signal; the Celsius bands below are community context.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ThermalState {
    Nominal,
    Fair,
    Serious,
    Critical,
}

impl ThermalState {
    /// The integer stored in SQLite; it keeps the enum's order.
    pub fn as_i64(self) -> i64 {
        match self {
            ThermalState::Nominal => 0,
            ThermalState::Fair => 1,
            ThermalState::Serious => 2,
            ThermalState::Critical => 3,
        }
    }

    /// Inverse of `as_i64`. A value we do not know is clamped rather than
    /// rejected: a future macOS level reads as the worst one we know, and a
    /// corrupt negative reads as calm.
    pub fn from_i64(value: i64) -> ThermalState {
        match value {
            i64::MIN..=0 => ThermalState::Nominal,
            1 => ThermalState::Fair,
            2 => ThermalState::Serious,
            _ => ThermalState::Critical,
        }
    }
}

/// Community-reported context for the average die temperature. Not an Apple
/// threshold; see ADR 0010.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ThermalBand {
    Cool,
    Normal,
    Warm,
    Hot,
    Throttling,
}

/// The band for an average die temperature. Lower edges are inclusive, so
/// exactly 50 °C is already `Normal` and exactly 100 °C is `Throttling`.
pub fn band_for(avg_c: f64) -> ThermalBand {
    if avg_c < 50.0 {
        ThermalBand::Cool
    } else if avg_c < 70.0 {
        ThermalBand::Normal
    } else if avg_c < 90.0 {
        ThermalBand::Warm
    } else if avg_c < 100.0 {
        ThermalBand::Hot
    } else {
        ThermalBand::Throttling
    }
}

/// Mean and maximum over the valid die sensors of one read.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Summary {
    pub avg_c: f64,
    pub max_c: f64,
    pub sensors: usize,
}

/// Keeps the `tdie` sensors (the CPU dies; battery and SSD sensors would
/// drag the average) whose value is finite and plausible, then summarizes
/// them. `None` when no sensor qualifies, which is the normal answer on a
/// Mac or VM that exposes none.
pub fn summarize<'a>(sensors: impl IntoIterator<Item = (&'a str, f32)>) -> Option<Summary> {
    let mut sum = 0.0;
    let mut max = f64::MIN;
    let mut count = 0usize;
    for (label, value) in sensors {
        let value = f64::from(value);
        let valid = label.to_ascii_lowercase().contains("tdie")
            && value.is_finite()
            && (MIN_PLAUSIBLE_C..=MAX_PLAUSIBLE_C).contains(&value);
        if valid {
            sum += value;
            max = max.max(value);
            count += 1;
        }
    }
    (count > 0).then(|| Summary {
        avg_c: sum / count as f64,
        max_c: max,
        sensors: count,
    })
}

/// One full reading: temperatures, macOS pressure level and when it was taken.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Reading {
    pub avg_c: f64,
    pub max_c: f64,
    pub sensors: usize,
    pub state: ThermalState,
    pub at_s: i64,
}

fn summarize_components(components: &Components) -> Option<Summary> {
    summarize(
        components
            .list()
            .iter()
            .filter_map(|c| Some((c.label(), c.temperature()?))),
    )
}

/// A long-lived reader: it enumerates the sensors once and later reads only
/// refresh their values, which is cheaper than listing them every minute.
pub struct Sensors(Components);

impl Sensors {
    pub fn new() -> Sensors {
        Sensors(Components::new_with_refreshed_list())
    }

    pub fn read(&mut self) -> Option<Summary> {
        self.0.refresh(false);
        summarize_components(&self.0)
    }
}

impl Default for Sensors {
    fn default() -> Self {
        Sensors::new()
    }
}

/// macOS's current thermal pressure level.
#[cfg(target_os = "macos")]
pub fn thermal_state() -> ThermalState {
    use objc2_foundation::{NSProcessInfo, NSProcessInfoThermalState};

    let state = NSProcessInfo::processInfo().thermalState();
    if state == NSProcessInfoThermalState::Nominal {
        ThermalState::Nominal
    } else if state == NSProcessInfoThermalState::Fair {
        ThermalState::Fair
    } else if state == NSProcessInfoThermalState::Serious {
        ThermalState::Serious
    } else if state == NSProcessInfoThermalState::Critical {
        ThermalState::Critical
    } else {
        // A level added by a newer macOS: treat it as the worst we know.
        ThermalState::Critical
    }
}

/// Other platforms expose no pressure level, so it is always calm.
#[cfg(not(target_os = "macos"))]
pub fn thermal_state() -> ThermalState {
    ThermalState::Nominal
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dead_sensor_at_minus_9201_is_dropped() {
        let s = summarize([
            ("PMU tdie1", 52.0),
            ("PMU tdie2", -9201.0),
            ("PMU tdie3", 56.0),
        ])
        .unwrap();
        assert_eq!(s.sensors, 2);
        assert_eq!(s.avg_c, 54.0);
        assert_eq!(s.max_c, 56.0);
    }

    #[test]
    fn values_outside_the_plausible_range_are_dropped() {
        let s = summarize([
            ("PMU tdie1", 0.5),
            ("PMU tdie2", 130.5),
            ("PMU tdie3", 1.0),
            ("PMU tdie4", 130.0),
        ])
        .unwrap();
        assert_eq!(s.sensors, 2);
        assert_eq!(s.max_c, 130.0);
    }

    #[test]
    fn non_tdie_sensors_are_ignored() {
        let s = summarize([
            ("PMU tdie1", 50.0),
            ("PMU tdev1", 30.0),
            ("gas gauge battery", 31.0),
        ])
        .unwrap();
        assert_eq!(s.sensors, 1);
        assert_eq!(s.avg_c, 50.0);
    }

    #[test]
    fn label_match_ignores_case() {
        let s = summarize([("PMU TDIE1", 60.0)]).unwrap();
        assert_eq!(s.sensors, 1);
    }

    #[test]
    fn no_tdie_sensor_gives_none() {
        assert_eq!(
            summarize([("PMU tdev1", 30.0), ("gas gauge battery", 31.0)]),
            None
        );
        assert_eq!(summarize(Vec::<(&str, f32)>::new()), None);
    }

    #[test]
    fn only_invalid_tdie_sensors_give_none() {
        assert_eq!(summarize([("PMU tdie1", -9201.0)]), None);
    }

    #[test]
    fn nan_and_infinite_are_dropped() {
        let s = summarize([
            ("PMU tdie1", f32::NAN),
            ("PMU tdie2", f32::INFINITY),
            ("PMU tdie3", 60.0),
        ])
        .unwrap();
        assert_eq!(s.sensors, 1);
        assert_eq!(s.avg_c, 60.0);
    }

    #[test]
    fn band_edges_are_lower_inclusive() {
        assert_eq!(band_for(49.99), ThermalBand::Cool);
        assert_eq!(band_for(50.0), ThermalBand::Normal);
        assert_eq!(band_for(69.99), ThermalBand::Normal);
        assert_eq!(band_for(70.0), ThermalBand::Warm);
        assert_eq!(band_for(89.99), ThermalBand::Warm);
        assert_eq!(band_for(90.0), ThermalBand::Hot);
        assert_eq!(band_for(99.99), ThermalBand::Hot);
        assert_eq!(band_for(100.0), ThermalBand::Throttling);
        assert_eq!(band_for(125.0), ThermalBand::Throttling);
    }

    #[test]
    fn state_order_follows_severity() {
        assert!(ThermalState::Nominal < ThermalState::Fair);
        assert!(ThermalState::Fair < ThermalState::Serious);
        assert!(ThermalState::Serious < ThermalState::Critical);
    }

    #[test]
    fn state_round_trips_through_i64() {
        for state in [
            ThermalState::Nominal,
            ThermalState::Fair,
            ThermalState::Serious,
            ThermalState::Critical,
        ] {
            assert_eq!(ThermalState::from_i64(state.as_i64()), state);
        }
        assert_eq!(ThermalState::Nominal.as_i64(), 0);
        assert_eq!(ThermalState::Critical.as_i64(), 3);
    }

    #[test]
    fn from_i64_clamps_out_of_range_values() {
        assert_eq!(ThermalState::from_i64(-1), ThermalState::Nominal);
        assert_eq!(ThermalState::from_i64(i64::MIN), ThermalState::Nominal);
        assert_eq!(ThermalState::from_i64(4), ThermalState::Critical);
        assert_eq!(ThermalState::from_i64(i64::MAX), ThermalState::Critical);
    }

    #[test]
    fn serde_names_are_lowercase() {
        assert_eq!(
            serde_json::to_string(&ThermalState::Serious).unwrap(),
            "\"serious\""
        );
        assert_eq!(
            serde_json::to_string(&ThermalBand::Throttling).unwrap(),
            "\"throttling\""
        );
    }
}
