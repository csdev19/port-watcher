//! Heat aggregation from raw sensor readings.

use super::sensor::{Reading, SensorGroup, Validity};
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Heat {
    pub cpu_max_c: f32,
    /// Average over usable CPU sensors; power-gated keys are excluded (they pin the average low).
    pub cpu_avg_c: f32,
    pub gpu_max_c: Option<f32>,
    pub sensors_used: u16,
    pub sensors_gated: u16,
}

/// `None` when there is no usable CPU sensor at all.
pub fn aggregate(readings: &[Reading]) -> Option<Heat> {
    let mut cpu = Vec::new();
    let mut gpu = Vec::new();
    let mut gated = 0u16;
    for r in readings {
        match (r.group(), r.validity()) {
            (SensorGroup::PerfCore | SensorGroup::EffCore, Validity::Usable) => cpu.push(r.celsius),
            (SensorGroup::Gpu, Validity::Usable) => gpu.push(r.celsius),
            (_, Validity::PowerGated) => gated += 1,
            _ => {}
        }
    }
    if cpu.is_empty() {
        return None;
    }
    let max = |v: &[f32]| v.iter().copied().fold(f32::MIN, f32::max);
    Some(Heat {
        cpu_max_c: max(&cpu),
        cpu_avg_c: cpu.iter().sum::<f32>() / cpu.len() as f32,
        gpu_max_c: (!gpu.is_empty()).then(|| max(&gpu)),
        sensors_used: (cpu.len() + gpu.len()) as u16,
        sensors_gated: gated,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::sensor::SensorKey;

    fn readings_from_fixture() -> Vec<Reading> {
        include_str!("../../tests/fixtures/cool-sensors.txt")
            .lines()
            .filter_map(|l| {
                let mut it = l.split_whitespace();
                let key = SensorKey::new(it.next()?)?;
                let celsius = it.next()?.parse().ok()?;
                Some(Reading { key, celsius })
            })
            .collect()
    }

    #[test]
    fn empty_slice_is_none() {
        assert_eq!(aggregate(&[]), None);
    }

    #[test]
    fn only_non_cpu_sensors_is_none() {
        let r = [Reading {
            key: SensorKey::new("TCHP").unwrap(),
            celsius: 38.0,
        }];
        assert_eq!(aggregate(&r), None);
    }

    #[test]
    fn cool_baseline_fixture() {
        let readings = readings_from_fixture();
        assert_eq!(readings.len(), 285);
        let heat = aggregate(&readings).unwrap();
        assert_eq!(heat.cpu_max_c, 69.0);
        assert!(
            (heat.cpu_avg_c - 50.9).abs() < 0.05,
            "avg was {}",
            heat.cpu_avg_c
        );
        assert_eq!(heat.sensors_gated, 51);
        assert!(heat.gpu_max_c.is_some());
    }
}
