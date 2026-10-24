//! Application layer: the `Sources` port and the non-blocking `Sampler`.
//!
//! `Sampler` never sleeps. A load needs two snapshots, so the caller owns the cadence: 1 Hz
//! while a panel is open, 30 s or more for the opt-in background rules.

use crate::domain::{
    CpuTicks, Fan, MachineInfo, Memory, Power, ProcessCounters, ProcessUsage, Reading, Sample,
    Sort, ThermalPressure, aggregate, cpu, rank,
};
use serde::Serialize;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

/// What this machine and OS version can report. Probed once.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    pub smc: bool,
    pub sensors: u16,
    pub gpu: bool,
    pub thermal: bool,
    pub thermal_events: bool,
    pub memory_events: bool,
    pub system_power: bool,
    pub per_process_energy: bool,
}

impl Capabilities {
    /// One log line, for example `smc=ok sensors=134 gpu=ok thermal=ok ...`.
    pub fn summary(&self) -> String {
        let f = |b: bool| if b { "ok" } else { "missing" };
        format!(
            "smc={} sensors={} gpu={} thermal={} thermal-events={} memory-events={} system-power={} process-energy={}",
            f(self.smc),
            self.sensors,
            f(self.gpu),
            f(self.thermal),
            f(self.thermal_events),
            f(self.memory_events),
            f(self.system_power),
            f(self.per_process_energy)
        )
    }
}

/// Everything the sampler reads. Each source may be unavailable.
pub trait Sources {
    fn heat_readings(&mut self) -> Option<Vec<Reading>>;
    fn cpu_ticks(&mut self) -> Option<CpuTicks>;
    fn gpu_pct(&mut self) -> Option<u8>;
    fn fan(&mut self) -> Option<Fan>;
    fn system_watts(&mut self) -> Option<f32>;
    fn thermal_level(&mut self) -> Option<u8>;
    fn memory(&mut self) -> Memory;
    fn processes(&mut self) -> Vec<ProcessCounters>;
    fn machine(&self) -> MachineInfo;
    fn capabilities(&self) -> Capabilities;
}

/// Owned by one thread (`Send`, not `Sync`).
pub struct Sampler<S: Sources> {
    sources: S,
    prev_cpu: Option<CpuTicks>,
    prev_procs: Option<(Vec<ProcessCounters>, Instant)>,
}

impl<S: Sources> Sampler<S> {
    pub fn new(sources: S) -> Self {
        Self {
            sources,
            prev_cpu: None,
            prev_procs: None,
        }
    }

    pub fn machine(&self) -> MachineInfo {
        self.sources.machine()
    }

    pub fn capabilities(&self) -> Capabilities {
        self.sources.capabilities()
    }

    pub fn sources(&mut self) -> &mut S {
        &mut self.sources
    }

    /// Reads every source once. `cpu` is `None` on the first call.
    pub fn sample(&mut self) -> Sample {
        let ticks = self.sources.cpu_ticks();
        let cpu = match (&self.prev_cpu, &ticks) {
            (Some(prev), Some(curr)) => cpu::usage(prev, curr),
            _ => None,
        };
        self.prev_cpu = ticks;

        let heat = self.sources.heat_readings().and_then(|r| aggregate(&r));
        let thermal_raw = self.sources.thermal_level();
        Sample {
            taken_at_ms: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_or(0, |d| d.as_millis() as u64),
            cpu,
            gpu_pct: self.sources.gpu_pct(),
            heat,
            fan: self.sources.fan(),
            power: self
                .sources
                .system_watts()
                .map(|system_w| Power { system_w }),
            thermal: thermal_raw.map(|raw| ThermalPressure::from_notify_level(raw as u64)),
            thermal_raw,
            memory: self.sources.memory(),
        }
    }

    /// Top `n` processes since the previous call. The first call has no baseline: every row
    /// reports 0 % CPU.
    pub fn top(&mut self, sort: Sort, n: usize) -> Vec<ProcessUsage> {
        self.top_at(sort, n, Instant::now())
    }

    pub(crate) fn top_at(&mut self, sort: Sort, n: usize, now: Instant) -> Vec<ProcessUsage> {
        let curr = self.sources.processes();
        let (prev, dt_ms) = match &self.prev_procs {
            Some((p, at)) => (
                p.as_slice(),
                now.saturating_duration_since(*at).as_millis() as u64,
            ),
            None => (&[][..], 0),
        };
        let rows = rank(prev, &curr, dt_ms, sort, n);
        self.prev_procs = Some((curr, now));
        rows
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::verdict::Reason;
    use crate::domain::{
        CoreKind, CoreTicks, Level, MemoryPressure, SensorKey, Thresholds, evaluate,
    };
    use std::time::Duration;

    #[derive(Default)]
    struct FakeSources {
        cpu: Vec<Option<CpuTicks>>,
        readings: Option<Vec<Reading>>,
        thermal: Option<u8>,
        procs: Vec<Vec<ProcessCounters>>,
    }

    impl Sources for FakeSources {
        fn heat_readings(&mut self) -> Option<Vec<Reading>> {
            self.readings.clone()
        }
        fn cpu_ticks(&mut self) -> Option<CpuTicks> {
            if self.cpu.is_empty() {
                None
            } else {
                self.cpu.remove(0)
            }
        }
        fn gpu_pct(&mut self) -> Option<u8> {
            None
        }
        fn fan(&mut self) -> Option<Fan> {
            None
        }
        fn system_watts(&mut self) -> Option<f32> {
            None
        }
        fn thermal_level(&mut self) -> Option<u8> {
            self.thermal
        }
        fn memory(&mut self) -> Memory {
            Memory {
                total_bytes: 1,
                used_bytes: 1,
                compressed_bytes: 0,
                swap_bytes: 0,
                free_pct: 50,
                pressure: MemoryPressure::Normal,
            }
        }
        fn processes(&mut self) -> Vec<ProcessCounters> {
            if self.procs.is_empty() {
                vec![]
            } else {
                self.procs.remove(0)
            }
        }
        fn machine(&self) -> MachineInfo {
            MachineInfo {
                chip: "fake".into(),
                cores_p: 1,
                cores_e: 1,
                mem_total_bytes: 1,
            }
        }
        fn capabilities(&self) -> Capabilities {
            Capabilities {
                smc: true,
                sensors: 1,
                gpu: false,
                thermal: true,
                thermal_events: true,
                memory_events: true,
                system_power: false,
                per_process_energy: false,
            }
        }
    }

    fn ticks(busy: u32, idle: u32) -> Option<CpuTicks> {
        Some(CpuTicks {
            cores: vec![CoreTicks {
                kind: CoreKind::Performance,
                ticks: [busy, 0, idle, 0],
            }],
        })
    }

    fn proc(cpu_ms: u64) -> ProcessCounters {
        ProcessCounters {
            pid: 1,
            name: "p".into(),
            started_at: 1,
            cpu_time_ns: cpu_ms * 1_000_000,
            footprint_bytes: 1,
            energy_nj: None,
            path: None,
            uid: None,
        }
    }

    #[test]
    fn first_sample_has_no_cpu_second_has_values() {
        let mut s = Sampler::new(FakeSources {
            cpu: vec![ticks(0, 0), ticks(50, 50)],
            ..Default::default()
        });
        assert!(s.sample().cpu.is_none());
        assert_eq!(s.sample().cpu.unwrap().total_pct, 50.0);
    }

    #[test]
    fn heat_is_none_when_readings_are_none() {
        let mut s = Sampler::new(FakeSources::default());
        assert!(s.sample().heat.is_none());
    }

    #[test]
    fn heat_is_aggregated_from_readings() {
        let readings = vec![Reading {
            key: SensorKey::new("Tp01").unwrap(),
            celsius: 60.0,
        }];
        let mut s = Sampler::new(FakeSources {
            readings: Some(readings),
            ..Default::default()
        });
        assert_eq!(s.sample().heat.unwrap().cpu_max_c, 60.0);
    }

    #[test]
    fn sensors_unavailable_only_when_heat_and_thermal_are_both_missing() {
        let t = Thresholds::default();
        let mut none = Sampler::new(FakeSources::default());
        let v = evaluate(&none.sample(), &t);
        assert!(v.reasons.contains(&Reason::SensorsUnavailable));
        assert_eq!(v.level, Level::Ok);

        let mut with_thermal = Sampler::new(FakeSources {
            thermal: Some(0),
            ..Default::default()
        });
        assert!(
            !evaluate(&with_thermal.sample(), &t)
                .reasons
                .contains(&Reason::SensorsUnavailable)
        );
    }

    #[test]
    fn thermal_level_is_mapped() {
        let mut s = Sampler::new(FakeSources {
            thermal: Some(2),
            ..Default::default()
        });
        let sample = s.sample();
        assert_eq!(sample.thermal, Some(ThermalPressure::Serious));
        assert_eq!(sample.thermal_raw, Some(2));
    }

    #[test]
    fn top_uses_the_previous_process_counters() {
        let mut s = Sampler::new(FakeSources {
            procs: vec![vec![proc(0)], vec![proc(500)]],
            ..Default::default()
        });
        let t0 = Instant::now();
        assert_eq!(s.top_at(Sort::Cpu, 5, t0)[0].cpu_pct, 0.0);
        let second = s.top_at(Sort::Cpu, 5, t0 + Duration::from_secs(1));
        assert_eq!(second[0].cpu_pct, 50.0);
    }
}
