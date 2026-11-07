//! The background sampler: once a minute it reads the die sensors, feeds the
//! 5-minute bucket accumulator, records peaks with the busiest processes and
//! sends the "running hot" notification (ADR 0008). The decisions are pure
//! types with tests; `init` and `run_loop` are the thin runtime around them.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System};
use tauri::{AppHandle, Manager};

use super::reading::{thermal_state, Reading, Sensors, ThermalState};
use super::store::{Bucket, Peak, PeakProcess, Store};

/// Width of one history bucket, aligned to the wall clock.
pub const BUCKET_SECS: i64 = 300;
/// How often the sampler wakes.
pub const TICK: Duration = Duration::from_secs(60);
/// At most one peak row per this window; a hotter reading updates it.
pub const PEAK_WINDOW_SECS: i64 = 900;
/// At most one notification per this window.
pub const NOTIFY_WINDOW_SECS: i64 = 900;
/// A hottest-sensor reading at or above this is a peak.
pub const PEAK_MAX_C: f64 = 95.0;
/// Buckets and peaks older than this are deleted.
pub const RETENTION_SECS: i64 = 90 * 24 * 60 * 60;

/// Settings key read from `settings.json` on every tick.
const GUARD_SETTING: &str = "thermalGuardEnabled";
/// Processes stored with a peak.
const TOP_PROCESSES: usize = 5;

/// A finished bucket plus the minutes it spent at serious pressure or worse.
#[derive(Debug, Clone, PartialEq)]
pub struct ClosedBucket {
    pub bucket: Bucket,
    pub serious_minutes: i64,
}

struct Open {
    start_s: i64,
    min_c: f64,
    sum_c: f64,
    max_avg_c: f64,
    max_c: f64,
    worst: ThermalState,
    samples: i64,
    serious: i64,
}

impl Open {
    fn new(start_s: i64, r: &Reading) -> Open {
        Open {
            start_s,
            min_c: r.avg_c,
            sum_c: r.avg_c,
            max_avg_c: r.avg_c,
            max_c: r.max_c,
            worst: r.state,
            samples: 1,
            serious: i64::from(r.state >= ThermalState::Serious),
        }
    }

    fn add(&mut self, r: &Reading) {
        self.min_c = self.min_c.min(r.avg_c);
        self.sum_c += r.avg_c;
        self.max_avg_c = self.max_avg_c.max(r.avg_c);
        self.max_c = self.max_c.max(r.max_c);
        self.worst = self.worst.max(r.state);
        self.samples += 1;
        self.serious += i64::from(r.state >= ThermalState::Serious);
    }

    fn close(self) -> ClosedBucket {
        ClosedBucket {
            bucket: Bucket {
                start_s: self.start_s,
                min_c: self.min_c,
                avg_c: self.sum_c / self.samples as f64,
                max_avg_c: self.max_avg_c,
                max_c: self.max_c,
                worst_state: self.worst.as_i64(),
                samples: self.samples,
            },
            // One sample is one minute of the 60 s tick.
            serious_minutes: self.serious,
        }
    }
}

/// Folds readings into wall-clock-aligned buckets.
#[derive(Default)]
pub struct BucketAccumulator {
    open: Option<Open>,
}

impl BucketAccumulator {
    /// Adds a reading. When it belongs to a later bucket than the open one,
    /// the open one is closed and returned and a new one starts.
    pub fn push(&mut self, r: &Reading) -> Option<ClosedBucket> {
        let start_s = r.at_s - r.at_s.rem_euclid(BUCKET_SECS);
        match self.open.as_mut() {
            Some(open) if open.start_s == start_s => {
                open.add(r);
                None
            }
            _ => self.open.replace(Open::new(start_s, r)).map(Open::close),
        }
    }

    /// Closes the open bucket on demand (when the guard is turned off).
    pub fn take(&mut self) -> Option<ClosedBucket> {
        self.open.take().map(Open::close)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PeakDecision {
    None,
    Insert,
    Update(i64),
}

/// Decides when a reading becomes a stored peak.
#[derive(Default)]
pub struct PeakPolicy {
    /// The last stored peak: row id, when its window started, hottest sensor.
    pub last: Option<(i64, i64, f64)>,
}

impl PeakPolicy {
    pub fn decide(&self, r: &Reading) -> PeakDecision {
        let hot = r.max_c >= PEAK_MAX_C || r.state >= ThermalState::Serious;
        if !hot {
            return PeakDecision::None;
        }
        match self.last {
            Some((id, at_s, max_c)) if r.at_s - at_s < PEAK_WINDOW_SECS => {
                if r.max_c > max_c {
                    PeakDecision::Update(id)
                } else {
                    PeakDecision::None
                }
            }
            _ => PeakDecision::Insert,
        }
    }

    /// Call after the store wrote the row.
    pub fn record(&mut self, id: i64, at_s: i64, max_c: f64) {
        self.last = Some((id, at_s, max_c));
    }
}

/// Rate-limits the "running hot" notification.
#[derive(Default)]
pub struct NotifyPolicy {
    pub last_at: Option<i64>,
}

impl NotifyPolicy {
    pub fn should_notify(&mut self, r: &Reading) -> bool {
        if r.state < ThermalState::Serious {
            return false;
        }
        let due = self
            .last_at
            .is_none_or(|last| r.at_s - last >= NOTIFY_WINDOW_SECS);
        if due {
            self.last_at = Some(r.at_s);
        }
        due
    }
}

/// On unless explicitly `false`, like the auto-update setting.
pub fn guard_enabled(stored: Option<&serde_json::Value>) -> bool {
    !matches!(stored, Some(serde_json::Value::Bool(false)))
}

/// The local calendar date of an epoch second, `YYYY-MM-DD`.
pub fn local_day(start_s: i64) -> String {
    use chrono::TimeZone;
    chrono::Local
        .timestamp_opt(start_s, 0)
        .earliest()
        .map(|t| t.format("%Y-%m-%d").to_string())
        .unwrap_or_default()
}

/// Notification text: the temperature, what macOS reports, and the busiest
/// process that holds a listening port, when there is one.
pub fn notification_body(r: &Reading, top: &[PeakProcess]) -> String {
    let level = match r.state {
        ThermalState::Critical => "critical",
        _ => "serious",
    };
    let mut body = format!("{:.0} °C, macOS reports {level} thermal pressure.", r.avg_c);
    if let Some(p) = top.iter().find(|p| !p.ports.is_empty()) {
        body.push_str(&format!(
            " Busiest with a port: {} on {}.",
            p.name, p.ports[0]
        ));
    }
    body
}

/// Managed Tauri state: the history store (`None` when it could not open;
/// current readings still work) and the long-lived sensor reader.
pub struct Thermal {
    pub store: Mutex<Option<Store>>,
    pub sensors: Mutex<Sensors>,
}

/// One full reading from the shared sensor reader: temperatures plus the
/// pressure level macOS reports. `None` when no die sensor is usable.
pub fn read_reading(sensors: &mut Sensors, at_s: i64) -> Option<Reading> {
    let s = sensors.read()?;
    Some(Reading {
        avg_c: s.avg_c,
        max_c: s.max_c,
        sensors: s.sensors,
        state: thermal_state(),
        at_s,
    })
}

fn now_s() -> i64 {
    chrono::Utc::now().timestamp()
}

fn guard_wanted(app: &AppHandle) -> bool {
    use tauri_plugin_store::StoreExt;
    app.store("settings.json")
        .map(|s| guard_enabled(s.get(GUARD_SETTING).as_ref()))
        .unwrap_or(true)
}

/// The top processes by CPU over the last refresh interval, each with the
/// ports it listens on. A failed port scan only means empty port lists.
fn top_processes(system: &System) -> Vec<PeakProcess> {
    let mut ports: HashMap<u32, Vec<u16>> = HashMap::new();
    match crate::ports::source::raw_ports() {
        Ok(list) => {
            for p in list {
                ports.entry(p.pid).or_default().push(p.port);
            }
        }
        Err(e) => log::warn!("thermal: could not list ports for a peak ({e})"),
    }
    let mut all: Vec<(u32, String, f32)> = system
        .processes()
        .iter()
        .map(|(pid, p)| {
            (
                pid.as_u32(),
                p.name().to_string_lossy().into_owned(),
                p.cpu_usage(),
            )
        })
        .collect();
    all.sort_by(|a, b| b.2.total_cmp(&a.2));
    all.into_iter()
        .take(TOP_PROCESSES)
        .map(|(pid, name, cpu)| PeakProcess {
            pid,
            name,
            cpu,
            ports: ports.remove(&pid).unwrap_or_default(),
        })
        .collect()
}

fn prune(app: &AppHandle) {
    let state = app.state::<Thermal>();
    let guard = state.store.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(store) = guard.as_ref() {
        match store.prune(now_s() - RETENTION_SECS) {
            Ok(n) if n > 0 => log::info!("thermal: pruned {n} old rows"),
            Ok(_) => {}
            Err(e) => log::error!("thermal: prune failed ({e})"),
        }
    }
}

/// Opens the store, manages the state and starts the sampler thread.
pub fn init(app: &AppHandle) {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| log::error!("thermal: no app data dir; history unavailable ({e})"))
        .ok();
    let store = data_dir.as_ref().and_then(|dir| {
        std::fs::create_dir_all(dir)
            .map_err(|e| e.to_string())
            .and_then(|_| Store::open(&dir.join("thermal.sqlite")).map_err(|e| e.to_string()))
            .map_err(|e| log::error!("thermal: history unavailable ({e})"))
            .ok()
    });
    app.manage(Thermal {
        store: Mutex::new(store),
        sensors: Mutex::new(Sensors::new()),
    });
    prune(app);

    let app = app.clone();
    let spawned = std::thread::Builder::new()
        .name("thermal-sampler".into())
        .spawn(move || run_loop(&app, data_dir));
    if let Err(e) = spawned {
        log::error!("thermal: could not start the sampler ({e})");
    }
}

/// The first local day of a window of `days` calendar days ending today.
pub fn window_start_day(now_s: i64, days: i64) -> String {
    local_day(now_s - (days.max(1) - 1) * 86_400)
}

/// An exclusive, non-blocking `flock` on `thermal.sampler.lock`. `None` when
/// another process holds it, or when the file cannot be locked at all (logged).
///
/// A dev build and the installed app share the bundle id, so they share
/// thermal.sqlite; only the holder samples, or every peak, notification and
/// daily total would be written twice.
fn sampler_lock(dir: &std::path::Path) -> Option<nix::fcntl::Flock<std::fs::File>> {
    use nix::fcntl::{Flock, FlockArg};
    let file = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(dir.join("thermal.sampler.lock"))
        .map_err(|e| log::error!("thermal: cannot open the sampler lock ({e})"))
        .ok()?;
    match Flock::lock(file, FlockArg::LockExclusiveNonblock) {
        Ok(lock) => Some(lock),
        Err((_, nix::errno::Errno::EWOULDBLOCK)) => None,
        Err((_, e)) => {
            log::error!("thermal: cannot lock the sampler lock ({e})");
            None
        }
    }
}

fn refresh_cpu(system: &mut System) {
    system.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing().with_cpu(),
    );
}

fn run_loop(app: &AppHandle, data_dir: Option<std::path::PathBuf>) {
    // Retried every tick, so this process takes over when the holder quits.
    // Held for the thread's life; the OS releases it if chapay dies.
    let mut lock = None;
    let mut waiting_logged = false;
    let mut system = System::new();
    // Prime the CPU counters: usage is measured between two refreshes.
    refresh_cpu(&mut system);
    let mut acc = BucketAccumulator::default();
    let mut peaks = PeakPolicy::default();
    let mut notify = NotifyPolicy::default();
    // The memory guard's half of the tick (ADR 0011), gated by its own setting.
    let mut memory = crate::memory::sampler::MemorySampler::default();
    let mut day = local_day(now_s());
    loop {
        std::thread::sleep(TICK);
        if lock.is_none() {
            lock = data_dir.as_deref().and_then(sampler_lock);
            match (&lock, waiting_logged) {
                (None, false) => {
                    log::info!("thermal: another chapay is sampling; waiting for its lock");
                    waiting_logged = true;
                }
                (Some(_), true) => log::info!("thermal: took over sampling"),
                _ => {}
            }
            if lock.is_none() {
                continue;
            }
        }
        if guard_wanted(app) {
            tick(app, &mut system, &mut acc, &mut peaks, &mut notify);
        } else if let Some(c) = acc.take() {
            // Turned off: write what is open, so the bucket does not linger.
            store_bucket(app, &c);
        }
        memory.tick(app);
        let today = local_day(now_s());
        if today != day {
            day = today;
            prune(app);
        }
    }
}

fn store_bucket(app: &AppHandle, c: &ClosedBucket) {
    let state = app.state::<Thermal>();
    let guard = state.store.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(store) = guard.as_ref() {
        if let Err(e) =
            store.insert_bucket(&c.bucket, &local_day(c.bucket.start_s), c.serious_minutes)
        {
            log::error!("thermal: could not store a bucket ({e})");
        }
    }
}

fn tick(
    app: &AppHandle,
    system: &mut System,
    acc: &mut BucketAccumulator,
    peaks: &mut PeakPolicy,
    notify: &mut NotifyPolicy,
) {
    let state = app.state::<Thermal>();
    refresh_cpu(system);
    let reading = {
        let mut sensors = state.sensors.lock().unwrap_or_else(|e| e.into_inner());
        read_reading(&mut sensors, now_s())
    };
    let Some(reading) = reading else {
        return;
    };

    let closed = acc.push(&reading);
    let decision = peaks.decide(&reading);
    let notify_now = notify.should_notify(&reading);
    let top = if decision != PeakDecision::None || notify_now {
        top_processes(system)
    } else {
        Vec::new()
    };

    {
        let guard = state.store.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(store) = guard.as_ref() {
            if let Some(c) = closed {
                if let Err(e) =
                    store.insert_bucket(&c.bucket, &local_day(c.bucket.start_s), c.serious_minutes)
                {
                    log::error!("thermal: could not store a bucket ({e})");
                }
            }
            if decision != PeakDecision::None {
                let (id, anchor) = match decision {
                    PeakDecision::Update(id) => {
                        (Some(id), peaks.last.map_or(reading.at_s, |l| l.1))
                    }
                    _ => (None, reading.at_s),
                };
                let peak = Peak {
                    id,
                    at_s: reading.at_s,
                    avg_c: reading.avg_c,
                    max_c: reading.max_c,
                    state: reading.state.as_i64(),
                    processes: top.clone(),
                };
                match store.upsert_peak(&peak) {
                    // The window stays anchored on the first reading.
                    Ok(id) => peaks.record(id, anchor, reading.max_c),
                    Err(e) => log::error!("thermal: could not store a peak ({e})"),
                }
            }
        }
    }

    if notify_now {
        use tauri_plugin_notification::NotificationExt;
        if let Err(e) = app
            .notification()
            .builder()
            .title("Your Mac is running hot")
            .body(notification_body(&reading, &top))
            .show()
        {
            log::warn!("thermal: could not send the notification ({e})");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn only_one_holder_of_the_sampler_lock() {
        let dir = tempfile::tempdir().unwrap();
        let first = sampler_lock(dir.path());
        assert!(first.is_some());
        // A second open file description is refused while the first holds it.
        assert!(sampler_lock(dir.path()).is_none());
        drop(first);
        assert!(sampler_lock(dir.path()).is_some());
    }

    fn reading(at_s: i64, avg_c: f64, max_c: f64, state: ThermalState) -> Reading {
        Reading {
            avg_c,
            max_c,
            sensors: 4,
            state,
            at_s,
        }
    }

    fn calm(at_s: i64, avg_c: f64) -> Reading {
        reading(at_s, avg_c, avg_c + 5.0, ThermalState::Nominal)
    }

    #[test]
    fn readings_in_one_bucket_do_not_close_it() {
        let mut acc = BucketAccumulator::default();
        assert!(acc.push(&calm(600, 50.0)).is_none());
        assert!(acc.push(&calm(660, 60.0)).is_none());
        assert!(acc.push(&calm(899, 70.0)).is_none());
    }

    #[test]
    fn a_reading_in_a_new_bucket_closes_the_open_one_aligned_to_300() {
        let mut acc = BucketAccumulator::default();
        acc.push(&calm(610, 50.0));
        acc.push(&calm(670, 70.0));
        let closed = acc.push(&calm(905, 80.0)).expect("closes the 600 bucket");
        let b = closed.bucket;
        assert_eq!(b.start_s, 600);
        assert_eq!(b.samples, 2);
        assert_eq!(b.min_c, 50.0);
        assert_eq!(b.avg_c, 60.0);
        assert_eq!(b.max_avg_c, 70.0);
        assert_eq!(b.max_c, 75.0);
        // The new reading started the 900 bucket.
        let next = acc.take().unwrap().bucket;
        assert_eq!(next.start_s, 900);
        assert_eq!(next.samples, 1);
    }

    #[test]
    fn alignment_handles_negative_and_exact_boundaries() {
        let mut acc = BucketAccumulator::default();
        acc.push(&calm(300, 50.0));
        assert_eq!(acc.take().unwrap().bucket.start_s, 300);
        acc.push(&calm(-1, 50.0));
        assert_eq!(acc.take().unwrap().bucket.start_s, -300);
    }

    #[test]
    fn worst_state_and_serious_minutes_are_counted() {
        let mut acc = BucketAccumulator::default();
        acc.push(&reading(0, 60.0, 65.0, ThermalState::Fair));
        acc.push(&reading(60, 60.0, 65.0, ThermalState::Serious));
        acc.push(&reading(120, 60.0, 65.0, ThermalState::Critical));
        acc.push(&reading(180, 60.0, 65.0, ThermalState::Nominal));
        let closed = acc.take().unwrap();
        assert_eq!(closed.bucket.worst_state, ThermalState::Critical.as_i64());
        assert_eq!(closed.serious_minutes, 2);
    }

    #[test]
    fn take_on_an_empty_accumulator_is_none() {
        assert!(BucketAccumulator::default().take().is_none());
    }

    #[test]
    fn a_cool_reading_is_no_peak() {
        let p = PeakPolicy::default();
        assert_eq!(p.decide(&calm(0, 60.0)), PeakDecision::None);
    }

    #[test]
    fn hot_sensor_or_serious_state_inserts_a_peak() {
        let p = PeakPolicy::default();
        let hot = reading(0, 80.0, 95.0, ThermalState::Nominal);
        assert_eq!(p.decide(&hot), PeakDecision::Insert);
        let pressured = reading(0, 60.0, 70.0, ThermalState::Serious);
        assert_eq!(p.decide(&pressured), PeakDecision::Insert);
        let just_below = reading(0, 80.0, 94.9, ThermalState::Fair);
        assert_eq!(p.decide(&just_below), PeakDecision::None);
    }

    #[test]
    fn within_the_window_only_a_hotter_reading_updates() {
        let mut p = PeakPolicy::default();
        p.record(7, 1000, 96.0);
        let hotter = reading(1300, 85.0, 99.0, ThermalState::Nominal);
        assert_eq!(p.decide(&hotter), PeakDecision::Update(7));
        let cooler = reading(1300, 85.0, 95.5, ThermalState::Nominal);
        assert_eq!(p.decide(&cooler), PeakDecision::None);
        let equal = reading(1300, 85.0, 96.0, ThermalState::Nominal);
        assert_eq!(p.decide(&equal), PeakDecision::None);
    }

    #[test]
    fn a_new_peak_starts_after_the_window() {
        let mut p = PeakPolicy::default();
        p.record(7, 1000, 99.0);
        let later = reading(1000 + PEAK_WINDOW_SECS, 80.0, 95.0, ThermalState::Nominal);
        assert_eq!(p.decide(&later), PeakDecision::Insert);
        let inside = reading(
            1000 + PEAK_WINDOW_SECS - 1,
            80.0,
            95.0,
            ThermalState::Nominal,
        );
        assert_eq!(p.decide(&inside), PeakDecision::None);
    }

    #[test]
    fn notification_needs_serious_pressure() {
        let mut n = NotifyPolicy::default();
        assert!(!n.should_notify(&reading(0, 99.0, 110.0, ThermalState::Fair)));
        assert_eq!(n.last_at, None);
    }

    #[test]
    fn notification_is_rate_limited_to_one_per_window() {
        let mut n = NotifyPolicy::default();
        let at = |s| reading(s, 90.0, 95.0, ThermalState::Serious);
        assert!(n.should_notify(&at(1000)));
        assert!(!n.should_notify(&at(1060)), "suppressed inside the window");
        assert!(!n.should_notify(&at(1000 + NOTIFY_WINDOW_SECS - 1)));
        assert!(n.should_notify(&at(1000 + NOTIFY_WINDOW_SECS)));
        assert!(!n.should_notify(&at(1000 + NOTIFY_WINDOW_SECS + 60)));
    }

    #[test]
    fn guard_is_on_unless_explicitly_off() {
        assert!(guard_enabled(None));
        assert!(guard_enabled(Some(&json!(true))));
        assert!(
            guard_enabled(Some(&json!("false"))),
            "junk keeps the default"
        );
        assert!(!guard_enabled(Some(&json!(false))));
    }

    #[test]
    fn window_start_day_counts_today_as_day_one() {
        let now = 1_762_300_000;
        assert_eq!(window_start_day(now, 1), local_day(now));
        assert_eq!(window_start_day(now, 7), local_day(now - 6 * 86_400));
        assert_eq!(window_start_day(now, 0), local_day(now));
    }

    #[test]
    fn local_day_formats_as_iso_date() {
        let day = local_day(1_762_000_000);
        assert_eq!(day.len(), 10);
        assert_eq!(day.as_bytes()[4], b'-');
        assert_eq!(day.as_bytes()[7], b'-');
    }

    fn proc(name: &str, ports: &[u16]) -> PeakProcess {
        PeakProcess {
            pid: 1,
            name: name.into(),
            cpu: 50.0,
            ports: ports.to_vec(),
        }
    }

    #[test]
    fn body_names_the_busiest_process_with_a_port() {
        let r = reading(0, 92.0, 95.0, ThermalState::Serious);
        let body = notification_body(&r, &[proc("rustc", &[]), proc("vite", &[5173, 5174])]);
        assert_eq!(
            body,
            "92 °C, macOS reports serious thermal pressure. Busiest with a port: vite on 5173."
        );
    }

    #[test]
    fn body_omits_the_port_sentence_when_no_process_has_one() {
        let r = reading(0, 92.0, 95.0, ThermalState::Critical);
        let body = notification_body(&r, &[proc("rustc", &[])]);
        assert_eq!(body, "92 °C, macOS reports critical thermal pressure.");
    }

    /// Times the work of one tick (sensor read + thermal state + CPU refresh).
    /// Run with `cargo test tick_cost -- --ignored --nocapture`.
    #[test]
    #[ignore = "timing probe, needs real sensors"]
    fn tick_cost_is_printed() {
        let mut sensors = Sensors::new();
        let mut system = System::new();
        refresh_cpu(&mut system);
        for i in 0..3 {
            let t = std::time::Instant::now();
            let s = sensors.read();
            let st = thermal_state();
            let sensors_ms = t.elapsed();
            let t2 = std::time::Instant::now();
            refresh_cpu(&mut system);
            let cpu_ms = t2.elapsed();
            let t3 = std::time::Instant::now();
            let top = top_processes(&system);
            println!(
                "tick {i}: sensors+state {sensors_ms:?} ({s:?}, {st:?}), cpu refresh {cpu_ms:?}, top5+ports (peak only) {:?} -> {} procs",
                t3.elapsed(),
                top.len()
            );
        }
    }
}
