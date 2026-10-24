//! Pure domain: no I/O, no `unsafe`, no `cfg`.

pub mod attribution;
pub mod cpu;
pub mod heat;
pub mod machine;
pub mod memory;
pub mod sample;
pub mod sensor;
pub mod thermal;
pub mod threshold;
pub mod verdict;

pub use attribution::{ProcessCounters, ProcessUsage, Sort, rank};
pub use cpu::{CoreKind, CoreLoad, CoreTicks, CpuLoad, CpuTicks};
pub use heat::{Heat, aggregate};
pub use machine::MachineInfo;
pub use memory::{Memory, MemoryPressure};
pub use sample::{Fan, Power, Sample};
pub use sensor::{Reading, SensorGroup, SensorKey, Validity};
pub use thermal::ThermalPressure;
pub use threshold::{Band, Gauge, Thresholds};
pub use verdict::{Level, Reason, Verdict, evaluate};
