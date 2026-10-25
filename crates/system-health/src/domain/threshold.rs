//! Threshold bands. Fixed defaults; not user-editable (ADR 0011).

use super::verdict::Level;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Band {
    pub warn: f32,
    /// `None` makes the band informational: it can reach Watch but never Stop.
    pub stop: Option<f32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Gauge {
    Cpu,
    Gpu,
    /// The hottest usable CPU sensor, in Celsius.
    Heat,
    /// Swap in use, in GB.
    Memory,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Thresholds {
    pub cpu: Band,
    pub gpu: Band,
    pub hotspot_c: Band,
    pub swap_gb: Band,
}

impl Default for Thresholds {
    fn default() -> Self {
        Self {
            cpu: Band {
                warn: 80.0,
                stop: None,
            },
            gpu: Band {
                warn: 90.0,
                stop: None,
            },
            hotspot_c: Band {
                warn: 80.0,
                stop: Some(95.0),
            },
            swap_gb: Band {
                warn: 4.0,
                stop: None,
            },
        }
    }
}

impl Thresholds {
    pub fn band(&self, g: Gauge) -> &Band {
        match g {
            Gauge::Cpu => &self.cpu,
            Gauge::Gpu => &self.gpu,
            Gauge::Heat => &self.hotspot_c,
            Gauge::Memory => &self.swap_gb,
        }
    }

    pub fn level(&self, g: Gauge, value: f32) -> Level {
        let b = self.band(g);
        match b.stop {
            Some(stop) if value >= stop => Level::Stop,
            _ if value >= b.warn => Level::Watch,
            _ => Level::Ok,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cpu_and_gpu_never_reach_stop() {
        let t = Thresholds::default();
        assert_eq!(t.level(Gauge::Cpu, 79.9), Level::Ok);
        assert_eq!(t.level(Gauge::Cpu, 80.0), Level::Watch);
        assert_eq!(t.level(Gauge::Cpu, 100.0), Level::Watch);
        assert_eq!(t.level(Gauge::Gpu, 89.0), Level::Ok);
        assert_eq!(t.level(Gauge::Gpu, 100.0), Level::Watch);
    }

    #[test]
    fn heat_has_watch_and_stop() {
        let t = Thresholds::default();
        assert_eq!(t.level(Gauge::Heat, 79.0), Level::Ok);
        assert_eq!(t.level(Gauge::Heat, 80.0), Level::Watch);
        assert_eq!(t.level(Gauge::Heat, 94.9), Level::Watch);
        assert_eq!(t.level(Gauge::Heat, 95.0), Level::Stop);
    }

    #[test]
    fn swap_is_watch_only() {
        let t = Thresholds::default();
        assert_eq!(t.level(Gauge::Memory, 3.9), Level::Ok);
        assert_eq!(t.level(Gauge::Memory, 4.0), Level::Watch);
        assert_eq!(t.level(Gauge::Memory, 40.0), Level::Watch);
    }
}
