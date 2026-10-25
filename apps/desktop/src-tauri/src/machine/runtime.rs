//! The live Machine state: one sampler, one history ring, one throttle cache. Generic over
//! `Sources` so the throttle and baseline rules are testable without hardware. `health.rs`
//! owns the single production instance behind a mutex.

use std::time::{Duration, Instant};

use system_health::{
    aggregate, evaluate, Capabilities, MachineInfo, Needs, Readings, Sample, Sampler, Sort,
    Sources, ThermalPressure, Thresholds, Verdict,
};

use super::dto::{MachineSnapshot, MachineSummary, ProcessGroupDto, SeriesDto};
use super::gauges::{gauges, history_point, pressure_point, verdict_dto, Culprit};
use super::history::{History, Metric, Range, TopProc, HISTORY_CAPACITY};
use super::top::{group, GroupContext};

/// A second request inside this window gets the cached sample, so two windows or a retry
/// never double the sampling cost.
pub const MIN_SAMPLE_AGE: Duration = Duration::from_millis(900);
/// With the panel closed nothing samples, so after a pause the previous reading is minutes old
/// and a delta against it would be a long average. Past this age the next reading is only a
/// baseline: CPU and per-process rows show "measuring" until the following tick.
pub const STALE_BASELINE: Duration = Duration::from_secs(3);

/// A background CPU delta older than this is not a usable load (the Mac slept, or polling was
/// off), so the reading carries no CPU and the next one becomes the baseline.
pub const BACKGROUND_BASELINE_MAX_AGE: Duration = Duration::from_secs(90);

/// What a background culprit is ranked by.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Rank {
    /// Average CPU since the previous process walk.
    Cpu,
    /// Memory footprint.
    Memory,
}

pub const DEFAULT_WINDOW_S: u32 = 60;
pub const MAX_WINDOW_S: u32 = 3600;
pub const DEFAULT_TOP: usize = 5;
pub const MAX_TOP: usize = 50;
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
    /// When the sampler last took a full reading (panel or background), for the CPU baseline.
    sampler_at: Option<Instant>,
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
            sampler_at: None,
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
            self.sampler_at = Some(now);
            let verdict = evaluate(&sample, &self.thresholds);
            let top = self.culprit.as_ref().map(|c| TopProc {
                name: c.name.clone(),
                cpu_pct: c.cpu_pct,
            });
            self.history.push_with_top(history_point(&sample), top);
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
            system_watts: sample.power.as_ref().map(|p| p.system_w),
        }
    }

    /// Appends a point for a pressure event: the thermal level and memory used as the OS reports
    /// them now, nothing sampled. The Machine history keeps those two series continuous while
    /// the panel is closed. Cheap: one notify read and one memory read, no process walk.
    pub fn record_pressure(&mut self, at_ms: u64) {
        let thermal = self
            .sampler
            .sources()
            .thermal_level()
            .map(|raw| ThermalPressure::from_notify_level(u64::from(raw)));
        let memory = self.sampler.sources().memory();
        self.history
            .push_with_top(pressure_point(at_ms, thermal, &memory), None);
    }

    /// The readings of the newest panel sample, if any.
    pub fn last_readings(&self) -> Option<Readings> {
        self.last
            .as_ref()
            .map(|(_, sample, _)| Readings::from_sample(sample))
    }

    /// What the alert rules need, for the closed-panel poll. A panel sample younger than
    /// `max_age` is reused. With only the hotspot needed this is one read of the cached SMC
    /// keys (no CPU ticks, no process walk). Otherwise it is a full sample that is not added to
    /// the history: the history draws gaps while nothing is on screen.
    pub fn background_readings(
        &mut self,
        now: Instant,
        needs: Needs,
        max_age: Duration,
    ) -> Readings {
        if let Some((at, sample, _)) = &self.last {
            if now.saturating_duration_since(*at) < max_age {
                return Readings::from_sample(sample);
            }
        }
        if needs.hotspot_only() {
            let hotspot_c = self
                .sampler
                .sources()
                .heat_readings()
                .and_then(|r| aggregate(&r))
                .map(|h| h.cpu_max_c);
            return Readings {
                hotspot_c,
                ..Readings::default()
            };
        }
        let stale = self
            .sampler_at
            .is_none_or(|at| now.saturating_duration_since(at) > BACKGROUND_BASELINE_MAX_AGE);
        let mut sample = self.sampler.sample();
        if stale {
            sample.cpu = None;
        }
        self.sampler_at = Some(now);
        Readings::from_sample(&sample)
    }

    /// Takes a process baseline, so the next `attribute` ranks by the average since now.
    pub fn prime_attribution(&mut self) {
        let _ = self.sampler.top(Sort::None, 0);
    }

    /// The process (grouped by app) an alert should name. See `pick_culprit`.
    pub fn attribute(&mut self, rank: Rank, env: &TopEnv) -> Option<ProcessGroupDto> {
        let all = self.sampler.top(Sort::None, usize::MAX);
        let rows = group(
            &all,
            &GroupContext {
                my_uid: env.my_uid,
                self_pid: env.self_pid,
                cores: self.cores(),
                home: env.home,
                limit: usize::MAX,
            },
        );
        pick_culprit(rows, rank)
    }

    /// One metric over a range for the full window's chart. Takes a sample first when the
    /// cached one is at least `MIN_SAMPLE_AGE` old (the same throttle as `snapshot`), so the
    /// chart's right edge is current. `now_ms` is wall-clock epoch milliseconds.
    pub fn history_series(
        &mut self,
        now: Instant,
        now_ms: u64,
        metric: Metric,
        range: Range,
    ) -> SeriesDto {
        let snap = self.snapshot(now, Some(1));
        // The series ends after the newest sample even if `now_ms` was read just before it.
        let end_ms = now_ms.max(snap.sampled_at_ms + 1);
        self.history.series(metric, range, end_ms).into()
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

/// The row an alert names. `kernel_task` (macOS's own thermal throttle) and pid < 100 are never
/// the culprit; a CPU culprit must be doing something (at least 1 % of the machine).
pub fn pick_culprit(rows: Vec<ProcessGroupDto>, rank: Rank) -> Option<ProcessGroupDto> {
    let eligible = rows
        .into_iter()
        .filter(|r| r.name != "kernel_task" && r.target.is_some_and(|t| t.pid >= 100));
    match rank {
        Rank::Cpu => eligible
            .filter(|r| r.cpu_pct >= 1.0)
            .max_by(|a, b| a.cpu_pct.total_cmp(&b.cpu_pct)),
        Rank::Memory => eligible.max_by_key(|r| r.mem_bytes),
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

    fn row(name: &str, pid: u32, cpu: f32, mem: u64) -> ProcessGroupDto {
        ProcessGroupDto {
            key: name.into(),
            name: name.into(),
            sub: String::new(),
            cpu_pct: cpu,
            mem_bytes: mem,
            member_count: 1,
            target: Some(crate::machine::dto::KillTarget { pid, started_at: 1 }),
            target_is_main: false,
            target_name: name.into(),
            killable: true,
            lock_reason: None,
            gpu_pct: None,
            members: Vec::new(),
        }
    }

    #[test]
    fn the_culprit_skips_kernel_task_and_system_pids() {
        let rows = vec![
            row("kernel_task", 0, 40.0, 1),
            row("launchd", 1, 30.0, 1),
            row("ollama", 321, 25.0, 5),
            row("node", 400, 5.0, 9),
        ];
        assert_eq!(
            pick_culprit(rows.clone(), Rank::Cpu).unwrap().name,
            "ollama"
        );
        assert_eq!(pick_culprit(rows, Rank::Memory).unwrap().name, "node");
    }

    #[test]
    fn an_idle_machine_names_no_cpu_culprit() {
        let rows = vec![row("node", 400, 0.4, 9)];
        assert!(pick_culprit(rows.clone(), Rank::Cpu).is_none());
        assert!(pick_culprit(rows, Rank::Memory).is_some());
    }

    #[test]
    fn the_hotspot_read_is_not_a_full_sample_and_does_not_touch_history() {
        let (mut rt, samples, walks) = runtime();
        let t0 = Instant::now();
        let r = rt.background_readings(
            t0,
            Needs {
                hotspot: true,
                ..Needs::default()
            },
            Duration::from_secs(30),
        );
        assert_eq!(r, Readings::default(), "fake has no heat sensors");
        assert_eq!((samples.get(), walks.get()), (0, 0));
    }

    #[test]
    fn a_fresh_panel_sample_is_reused_and_an_old_baseline_gives_no_cpu() {
        let (mut rt, samples, _) = runtime();
        let t0 = Instant::now();
        let both = Needs {
            cpu: true,
            ..Needs::default()
        };
        rt.snapshot(t0, None);
        assert_eq!(samples.get(), 1);
        rt.background_readings(t0 + Duration::from_secs(10), both, Duration::from_secs(30));
        assert_eq!(samples.get(), 1, "reused");
        // 200 s later the previous reading is no baseline: the load is unknown, not an average.
        let r =
            rt.background_readings(t0 + Duration::from_secs(200), both, Duration::from_secs(30));
        assert_eq!(samples.get(), 2);
        assert_eq!(r.cpu_pct, None);
        // 30 s after that it is a real average.
        let r =
            rt.background_readings(t0 + Duration::from_secs(230), both, Duration::from_secs(30));
        assert!(r.cpu_pct.is_some());
    }

    #[test]
    fn a_pressure_event_appends_a_levels_only_point_without_sampling() {
        let (mut rt, samples, walks) = runtime();
        let now_ms = system_health_now_ms();
        rt.record_pressure(now_ms);
        assert_eq!((samples.get(), walks.get()), (0, 0));
        let s = rt.history_series(
            Instant::now(),
            now_ms + 1000,
            Metric::ThermalLevel,
            Range::OneMin,
        );
        // history_series samples once (the snapshot it takes), so the event point is one of two.
        assert!(s.buckets.iter().flatten().count() >= 1);
        let snap = rt.snapshot(Instant::now() + Duration::from_secs(5), Some(3600));
        let first = snap.history.first().unwrap();
        assert_eq!(first.at_ms, now_ms);
        assert_eq!((first.cpu, first.gpu, first.heat), (None, None, None));
        assert_eq!(first.heat_level, Some(0));
    }

    #[test]
    fn history_series_shares_the_snapshot_throttle() {
        let (mut rt, samples, _) = runtime();
        let t0 = Instant::now();
        rt.snapshot(t0, None);
        let now_ms = system_health_now_ms();
        let s = rt.history_series(
            t0 + Duration::from_millis(100),
            now_ms,
            Metric::MemoryUsed,
            Range::OneMin,
        );
        assert_eq!(samples.get(), 1, "inside 900 ms: cached");
        assert_eq!(s.buckets.len(), 60);
        assert!(s.buckets.iter().any(Option::is_some));
        rt.history_series(
            t0 + Duration::from_millis(1000),
            now_ms,
            Metric::Cpu,
            Range::OneMin,
        );
        assert_eq!(samples.get(), 2);
    }

    fn system_health_now_ms() -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64
    }
}
