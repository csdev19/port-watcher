//! The point-in-time sample the sampler produces.

use super::cpu::CpuLoad;
use super::heat::Heat;
use super::memory::Memory;
use super::thermal::ThermalPressure;
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Fan {
    pub rpm: f32,
    pub max_rpm: f32,
}

impl Fan {
    pub fn pct(&self) -> Option<f32> {
        (self.max_rpm > 0.0).then(|| 100.0 * self.rpm / self.max_rpm)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Power {
    pub system_w: f32,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Sample {
    pub taken_at_ms: u64,
    /// `None` on the first call (a load needs two snapshots).
    pub cpu: Option<CpuLoad>,
    pub gpu_pct: Option<u8>,
    /// `None` when the SMC is unavailable.
    pub heat: Option<Heat>,
    pub fan: Option<Fan>,
    pub power: Option<Power>,
    pub thermal: Option<ThermalPressure>,
    pub thermal_raw: Option<u8>,
    pub memory: Memory,
}
