//! Pure domain: no I/O, no `unsafe`, no `cfg`.

pub mod cpu;
pub mod heat;
pub mod memory;
pub mod sample;
pub mod sensor;
pub mod thermal;

pub use cpu::{CoreKind, CoreLoad, CoreTicks, CpuLoad, CpuTicks};
pub use heat::{Heat, aggregate};
pub use memory::{Memory, MemoryPressure};
pub use sample::{Fan, Power, Sample};
pub use sensor::{Reading, SensorGroup, SensorKey, Validity};
pub use thermal::ThermalPressure;
