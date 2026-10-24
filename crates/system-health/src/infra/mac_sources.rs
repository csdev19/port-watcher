//! `MacSources`: the production `Sources` over SMC, IORegistry, mach, sysctl and libproc.

use super::{cpu, gpu, machine, memory, procs::ProcessReader, ps, smc::Smc, thermal};
use crate::domain::{CpuTicks, Fan, MachineInfo, Memory, ProcessCounters, Reading, SensorGroup};
use crate::sampler::{Capabilities, Sources};
use std::collections::HashSet;

const HEAT_GROUPS: [SensorGroup; 3] = [
    SensorGroup::PerfCore,
    SensorGroup::EffCore,
    SensorGroup::Gpu,
];

pub struct MacSources {
    smc: Option<Smc>,
    procs: ProcessReader,
    machine: MachineInfo,
    caps: Capabilities,
}

impl MacSources {
    /// Opens every source and probes what works. Takes a few milliseconds (key discovery).
    pub fn new() -> Self {
        let smc = Smc::open();
        let mut procs = ProcessReader::new();
        let machine = machine::read();
        let thermal_ok = thermal::read_level().is_some();
        let caps = Capabilities {
            smc: smc.is_some(),
            sensors: smc
                .as_ref()
                .map_or(0, |s| s.sensor_count(&HEAT_GROUPS))
                .min(u16::MAX as usize) as u16,
            gpu: gpu::utilization_pct().is_some(),
            thermal: thermal_ok,
            thermal_events: thermal_ok,
            memory_events: memory::pressure().is_some(),
            system_power: smc.as_ref().is_some_and(|s| s.system_watts().is_some()),
            per_process_energy: procs.energy_supported(),
            system_processes: ps::available(),
        };
        Self {
            smc,
            procs,
            machine,
            caps,
        }
    }

    /// Every cached SMC temperature key with its reading, for `chapay sensors`.
    pub fn all_sensor_readings(&self) -> Vec<Reading> {
        self.smc.as_ref().map(Smc::read_all).unwrap_or_default()
    }
}

impl Default for MacSources {
    fn default() -> Self {
        Self::new()
    }
}

impl Sources for MacSources {
    fn heat_readings(&mut self) -> Option<Vec<Reading>> {
        let readings = self.smc.as_ref()?.read_cached(&HEAT_GROUPS);
        (!readings.is_empty()).then_some(readings)
    }

    fn cpu_ticks(&mut self) -> Option<CpuTicks> {
        cpu::read(self.machine.cores_e)
    }

    fn gpu_pct(&mut self) -> Option<u8> {
        gpu::utilization_pct()
    }

    fn fan(&mut self) -> Option<Fan> {
        let smc = self.smc.as_ref()?;
        Some(Fan {
            rpm: smc.fan_actual_rpm()?,
            max_rpm: smc.fan_max_rpm()?,
        })
    }

    fn system_watts(&mut self) -> Option<f32> {
        self.smc.as_ref()?.system_watts()
    }

    fn thermal_level(&mut self) -> Option<u8> {
        thermal::read_level()
    }

    fn memory(&mut self) -> Memory {
        memory::read()
    }

    /// libproc rows for the user's own processes (footprint and energy), then `ps` rows for
    /// everything libproc could not read: root's and other users' processes.
    fn processes(&mut self) -> Vec<ProcessCounters> {
        let mut rows = self.procs.read_all();
        if self.caps.system_processes {
            let seen: HashSet<u32> = rows.iter().map(|p| p.pid).collect();
            rows.extend(ps::read_except(&seen).unwrap_or_default());
        }
        rows
    }

    fn machine(&self) -> MachineInfo {
        self.machine.clone()
    }

    fn capabilities(&self) -> Capabilities {
        self.caps.clone()
    }
}
