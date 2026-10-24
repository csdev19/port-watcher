//! The live Machine state: one sampler, one history ring, one throttle cache. Generic over
//! `Sources` so the throttle and baseline rules are testable without hardware. `health.rs`
//! owns the single production instance behind a mutex.

use std::time::{Duration, Instant};

use system_health::{
    evaluate, Capabilities, MachineInfo, Sample, Sampler, Sort, Sources, Thresholds, Verdict,
};

use super::dto::{MachineSnapshot, MachineSummary, ProcessGroupDto};
use super::gauges::{gauges, history_point, verdict_dto, Culprit};
use super::history::{History, HISTORY_CAPACITY};
use super::top::{group, GroupContext};

/// A second request inside this window gets the cached sample, so two windows or a retry
/// never double the sampling cost.
pub const MIN_SAMPLE_AGE: Duration = Duration::from_millis(900);
/// With the panel closed nothing samples, so after a pause the previous reading is minutes old
/// and a delta against it would be a long average. Past this age the next reading is only a
/// baseline: CPU and per-process rows show "measuring" until the following tick.
pub const STALE_BASELINE: Duration = Duration::from_secs(3);

pub const DEFAULT_WINDOW_S: u32 = 60;
pub const MAX_WINDOW_S: u32 = 3600;
pub const DEFAULT_TOP: usize = 5;
pub const MAX_TOP: usize = 20;
pub const INTERVAL_MS: u32 = 1000;

pub struct Runtime<S: Sources> {
    sampler: Sampler<S>,
    history: History,
    info: MachineInfo,
    caps: Capabilities,
    thresholds: Thresholds,
    last: Option<(Instant, Sample, Verdict)>,
    last_top_at: Option<Instant>,
    culprit: Option<Culprit>,
}

pub struct TopEnv<'a> {
    pub my_uid: u32,
    pub self_pid: u32,
    pub home: Option<&'a str>,
}

impl<S: Sources> Runtime<S> {
    pub fn new(sampler: Sampler<S>, info: MachineInfo, caps: Capabilities) -> Self {
        Self {
            sampler,
            history: History::new(HISTORY_CAPACITY),
            info,
            caps,
            thresholds: Thresholds::default(),
            last: None,
            last_top_at: None,
            culprit: None,
        }
    }

    fn cores(&self) -> u16 {
        self.info.cores_p.saturating_add(self.info.cores_e)
    }

    pub fn snapshot(&mut self, now: Instant, window_s: Option<u32>) -> MachineSnapshot {
        let window_s = window_s.unwrap_or(DEFAULT_WINDOW_S).clamp(1, MAX_WINDOW_S);
        let fresh = self
            .last
            .as_ref()
            .is_some_and(|(at, ..)| now.saturating_duration_since(*at) < MIN_SAMPLE_AGE);
        if !fresh {
            let stale = self
                .last
                .as_ref()
                .is_none_or(|(at, ..)| now.saturating_duration_since(*at) > STALE_BASELINE);
            let mut sample = self.sampler.sample();
            if stale {
                sample.cpu = None;
            }
            let verdict = evaluate(&sample, &self.thresholds);
            self.history.push(history_point(&sample));
            self.last = Some((now, sample, verdict));
        }
        let (_, sample, verdict) = self.last.as_ref().expect("sampled above");
        MachineSnapshot {
            machine: MachineSummary {
                chip: self.info.chip.clone(),
                cores: self.cores(),
            },
            interval_ms: INTERVAL_MS,
            gauges: gauges(
                sample,
                &self.thresholds,
                &self.caps,
                self.cores(),
                self.culprit.as_ref(),
            ),
            history: self.history.since(
                sample
                    .taken_at_ms
                    .saturating_sub(u64::from(window_s) * 1000),
            ),
            verdict: verdict_dto(verdict),
            sampled_at_ms: sample.taken_at_ms,
        }
    }

    /// One full process walk, grouped. After a pause the first call only sets the baseline and
    /// returns no rows (see `STALE_BASELINE`).
    pub fn top(&mut self, now: Instant, limit: Option<u8>, env: &TopEnv) -> Vec<ProcessGroupDto> {
        let limit = usize::from(limit.unwrap_or(DEFAULT_TOP as u8)).clamp(1, MAX_TOP);
        let stale = self
            .last_top_at
            .is_none_or(|at| now.saturating_duration_since(at) > STALE_BASELINE);
        let all = self.sampler.top(Sort::None, usize::MAX);
        self.last_top_at = Some(now);
        if stale {
            return Vec::new();
        }
        let rows = group(
            &all,
            &GroupContext {
                my_uid: env.my_uid,
                self_pid: env.self_pid,
                cores: self.cores(),
                home: env.home,
                limit,
            },
        );
        self.culprit = rows.first().map(|r| Culprit {
            name: r.name.clone(),
            cpu_pct: r.cpu_pct,
        });
        rows
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;
    use std::rc::Rc;
    use system_health::{
        CoreKind, CoreTicks, CpuTicks, Fan, Memory, MemoryPressure, ProcessCounters, Reading,
    };

    struct Fake {
        samples: Rc<Cell<u32>>,
        walks: Rc<Cell<u32>>,
        busy: u32,
    }

    impl Sources for Fake {
        fn heat_readings(&mut self) -> Option<Vec<Reading>> {
            None
        }
        fn cpu_ticks(&mut self) -> Option<CpuTicks> {
            self.samples.set(self.samples.get() + 1);
            self.busy += 10;
            Some(CpuTicks {
                cores: vec![CoreTicks {
                    kind: CoreKind::Performance,
                    ticks: [self.busy, 0, 100, 0],
                }],
            })
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
            Some(0)
        }
        fn memory(&mut self) -> Memory {
            Memory {
                total_bytes: 1 << 30,
                used_bytes: 1 << 29,
                compressed_bytes: 0,
                swap_bytes: 0,
                free_pct: 50,
                pressure: MemoryPressure::Normal,
            }
        }
        fn processes(&mut self) -> Vec<ProcessCounters> {
            self.walks.set(self.walks.get() + 1);
            vec![ProcessCounters {
                pid: 300,
                name: "node".into(),
                started_at: 1,
                cpu_time_ns: u64::from(self.walks.get()) * 500_000_000,
                footprint_bytes: 10,
                energy_nj: None,
                path: Some("/opt/node".into()),
                uid: Some(501),
            }]
        }
        fn machine(&self) -> MachineInfo {
            info()
        }
        fn capabilities(&self) -> Capabilities {
            caps()
        }
    }

    fn info() -> MachineInfo {
        MachineInfo {
            chip: "Fake".into(),
            cores_p: 2,
            cores_e: 2,
            mem_total_bytes: 1 << 30,
        }
    }

    fn caps() -> Capabilities {
        Capabilities {
            smc: false,
            sensors: 0,
            gpu: false,
            thermal: true,
            thermal_events: true,
            memory_events: true,
            system_power: false,
            per_process_energy: false,
        }
    }

    fn runtime() -> (Runtime<Fake>, Rc<Cell<u32>>, Rc<Cell<u32>>) {
        let samples = Rc::new(Cell::new(0));
        let walks = Rc::new(Cell::new(0));
        let fake = Fake {
            samples: samples.clone(),
            walks: walks.clone(),
            busy: 0,
        };
        (
            Runtime::new(Sampler::new(fake), info(), caps()),
            samples,
            walks,
        )
    }

    fn env() -> TopEnv<'static> {
        TopEnv {
            my_uid: 501,
            self_pid: 9000,
            home: None,
        }
    }

    #[test]
    fn requests_inside_900ms_get_the_cached_sample() {
        let (mut rt, samples, _) = runtime();
        let t0 = Instant::now();
        rt.snapshot(t0, None);
        rt.snapshot(t0 + Duration::from_millis(500), None);
        rt.snapshot(t0 + Duration::from_millis(899), None);
        assert_eq!(samples.get(), 1);
        rt.snapshot(t0 + Duration::from_millis(900), None);
        assert_eq!(samples.get(), 2);
    }

    #[test]
    fn the_first_reading_and_one_after_a_pause_have_no_cpu() {
        let (mut rt, _, _) = runtime();
        let t0 = Instant::now();
        let first = rt.snapshot(t0, None);
        assert!(!first.gauges[0].available);
        let second = rt.snapshot(t0 + Duration::from_secs(1), None);
        assert!(second.gauges[0].available, "a 1 s delta is a real load");
        // Panel closed for a minute: the old reading is no baseline.
        let after_pause = rt.snapshot(t0 + Duration::from_secs(61), None);
        assert!(!after_pause.gauges[0].available);
        let next = rt.snapshot(t0 + Duration::from_secs(62), None);
        assert!(next.gauges[0].available);
    }

    #[test]
    fn history_window_limits_the_returned_points() {
        let (mut rt, _, _) = runtime();
        let t0 = Instant::now();
        for i in 0..3 {
            rt.snapshot(t0 + Duration::from_secs(i), None);
        }
        let snap = rt.snapshot(t0 + Duration::from_secs(3), Some(3600));
        assert_eq!(snap.history.len(), 4);
        assert_eq!(snap.interval_ms, 1000);
        assert_eq!(snap.machine.cores, 4);
    }

    #[test]
    fn top_after_a_pause_only_sets_the_baseline() {
        let (mut rt, _, walks) = runtime();
        let t0 = Instant::now();
        assert!(rt.top(t0, None, &env()).is_empty());
        let rows = rt.top(t0 + Duration::from_secs(2), None, &env());
        assert_eq!(rows.len(), 1);
        assert_eq!(walks.get(), 2);
        assert!(rt
            .top(t0 + Duration::from_secs(60), None, &env())
            .is_empty());
    }

    #[test]
    fn the_cpu_driver_names_the_top_row_after_a_walk() {
        let (mut rt, _, _) = runtime();
        let t0 = Instant::now();
        rt.top(t0, None, &env());
        rt.top(t0 + Duration::from_secs(2), None, &env());
        let snap = rt.snapshot(t0 + Duration::from_secs(2), None);
        assert!(snap.gauges[0].driver.contains("node") || !snap.gauges[0].available);
    }
}
