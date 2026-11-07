//! The memory half of the background tick (ADR 0011). The thermal sampler's
//! loop calls `tick` once a minute, under the same `thermal.sampler.lock`; this
//! file decides what a tick does and keeps the decisions as pure types with
//! tests, like `thermal/sampler.rs`.
//!
//! Gate: with `memoryGuardEnabled` false nothing is read, written or notified.

use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager};

use super::api::{observe, Observation};
use super::procs::ProcessReader;
use super::reading::MemoryPressure;
use super::store::MemoryBucket;
use super::topcmd;
use super::verdict::{evaluate, Evaluation, MemorySignal, MemoryThresholds, MemoryVerdict, GIB};
use crate::thermal::sampler::{guard_enabled, local_day, Thermal, BUCKET_SECS, NOTIFY_WINDOW_SECS};

/// Settings key read from `settings.json` on every tick.
pub const GUARD_SETTING: &str = "memoryGuardEnabled";
/// Settings key of the editable thresholds.
pub const THRESHOLDS_SETTING: &str = "memoryThresholds";
/// How often the cost of a tick is written to the debug log.
const COST_LOG_EVERY: Duration = Duration::from_secs(3600);

/// A finished bucket plus the minutes it spent at pressure warning or worse.
#[derive(Debug, Clone, PartialEq)]
pub struct ClosedMemoryBucket {
    pub bucket: MemoryBucket,
    pub warning_minutes: i64,
}

struct Open {
    start_s: i64,
    used_sum: f64,
    used_max: u64,
    swap_sum: f64,
    swap_max: u64,
    worst: MemoryPressure,
    samples: i64,
    warning: i64,
}

impl Open {
    fn new(start_s: i64, o: &Observation) -> Open {
        let mut open = Open {
            start_s,
            used_sum: 0.0,
            used_max: 0,
            swap_sum: 0.0,
            swap_max: 0,
            worst: MemoryPressure::Normal,
            samples: 0,
            warning: 0,
        };
        open.add(o);
        open
    }

    fn add(&mut self, o: &Observation) {
        let s = &o.system;
        self.used_sum += s.used_bytes as f64;
        self.used_max = self.used_max.max(s.used_bytes);
        self.swap_sum += s.swap_used_bytes as f64;
        self.swap_max = self.swap_max.max(s.swap_used_bytes);
        self.worst = self.worst.max(s.pressure);
        self.samples += 1;
        // One sample is one minute of the 60 s tick.
        self.warning += i64::from(s.pressure >= MemoryPressure::Warning);
    }

    fn close(self) -> ClosedMemoryBucket {
        let n = self.samples as f64;
        ClosedMemoryBucket {
            bucket: MemoryBucket {
                start_s: self.start_s,
                used_avg: self.used_sum / n,
                used_max: self.used_max,
                swap_avg: self.swap_sum / n,
                swap_max: self.swap_max,
                worst_pressure: self.worst,
                samples: self.samples,
            },
            warning_minutes: self.warning,
        }
    }
}

/// Folds observations into wall-clock-aligned 5-minute buckets.
#[derive(Default)]
pub struct MemoryAccumulator {
    open: Option<Open>,
}

impl MemoryAccumulator {
    /// Adds an observation. When it belongs to a later bucket than the open
    /// one, the open one is closed and returned and a new one starts.
    pub fn push(&mut self, o: &Observation) -> Option<ClosedMemoryBucket> {
        let start_s = o.at_s - o.at_s.rem_euclid(BUCKET_SECS);
        match self.open.as_mut() {
            Some(open) if open.start_s == start_s => {
                open.add(o);
                None
            }
            _ => self.open.replace(Open::new(start_s, o)).map(Open::close),
        }
    }

    /// Closes the open bucket on demand (when the guard is turned off).
    pub fn take(&mut self) -> Option<ClosedMemoryBucket> {
        self.open.take().map(Open::close)
    }
}

/// Rate-limits the STOP notification: one per 15 minutes, like the
/// temperature guard.
#[derive(Default)]
pub struct StopNotifyPolicy {
    pub last_at: Option<i64>,
}

impl StopNotifyPolicy {
    pub fn should_notify(&mut self, verdict: MemoryVerdict, at_s: i64) -> bool {
        if verdict != MemoryVerdict::Stop {
            return false;
        }
        let due = self
            .last_at
            .is_none_or(|last| at_s - last >= NOTIFY_WINDOW_SECS);
        if due {
            self.last_at = Some(at_s);
        }
        due
    }
}

/// What the gate decided for one tick.
#[derive(Debug, PartialEq)]
pub enum Gate {
    /// The guard is off: nothing was read. Carries the bucket that was open,
    /// so it does not linger.
    Off(Option<ClosedMemoryBucket>),
    /// The guard is on but the system figures could not be read; the tick
    /// does nothing (spec: the reading is null, nothing is written).
    Unreadable,
    On(Observation),
}

/// Reads only when the guard is on. `read` is not called while it is off.
pub fn gate(
    wanted: bool,
    acc: &mut MemoryAccumulator,
    read: impl FnOnce() -> Option<Observation>,
) -> Gate {
    if !wanted {
        return Gate::Off(acc.take());
    }
    match read() {
        Some(o) => Gate::On(o),
        None => Gate::Unreadable,
    }
}

fn gib(bytes: u64) -> String {
    format!("{:.1} GB", bytes as f64 / GIB as f64)
}

/// Notification text: the reasons in words and the process behind them.
pub fn notification_body(obs: &Observation, eval: &Evaluation) -> String {
    let flagged = |signal: MemorySignal| {
        obs.procs
            .iter()
            .zip(&eval.flags)
            .find(|(_, f)| f.contains(&signal))
            .map(|(p, _)| p)
    };
    let mut parts: Vec<String> = Vec::new();
    for reason in &eval.reasons {
        match reason {
            MemorySignal::Pressure => {
                let level = match obs.system.pressure {
                    MemoryPressure::Critical => "critical",
                    _ => "high",
                };
                parts.push(format!("memory pressure is {level}"));
            }
            MemorySignal::Swap if obs.system.swap_total_bytes > 0 => {
                let pct =
                    obs.system.swap_used_bytes as f64 / obs.system.swap_total_bytes as f64 * 100.0;
                parts.push(format!("swap is {pct:.0}% full"));
            }
            MemorySignal::Swap => {}
            MemorySignal::BigProcess => {
                if let Some(p) = flagged(MemorySignal::BigProcess) {
                    parts.push(format!("{} uses {}", p.name, gib(p.footprint_bytes)));
                }
            }
            MemorySignal::Growing => {
                if let Some(p) = flagged(MemorySignal::Growing) {
                    parts.push(format!("{} keeps growing", p.name));
                }
            }
        }
    }
    let mut sentence = parts.join("; ");
    if let Some(first) = sentence.get_mut(..1) {
        first.make_ascii_uppercase();
    }
    format!("{sentence}. Open chapay's Memory tab.")
}

/// Per-thread state of the memory half of the tick.
#[derive(Default)]
pub struct MemorySampler {
    reader: ProcessReader,
    acc: MemoryAccumulator,
    notify: StopNotifyPolicy,
    last_cost_log: Option<Instant>,
    /// The bucket whose boundary last triggered a `top` run.
    last_top_bucket: Option<i64>,
}

fn now_s() -> i64 {
    chrono::Utc::now().timestamp()
}

pub fn guard_wanted(app: &AppHandle) -> bool {
    use tauri_plugin_store::StoreExt;
    app.store("settings.json")
        .map(|s| guard_enabled(s.get(GUARD_SETTING).as_ref()))
        .unwrap_or(true)
}

/// The stored thresholds, or the defaults.
pub fn load_thresholds(app: &AppHandle) -> MemoryThresholds {
    use tauri_plugin_store::StoreExt;
    let stored = app
        .store("settings.json")
        .ok()
        .and_then(|s| s.get(THRESHOLDS_SETTING));
    MemoryThresholds::from_stored(stored.as_ref())
}

/// Persists the thresholds in `settings.json`, where the renderer's settings
/// store reads them too.
pub fn save_thresholds(app: &AppHandle, t: &MemoryThresholds) -> Result<(), String> {
    use tauri_plugin_store::StoreExt;
    let store = app.store("settings.json").map_err(|e| e.to_string())?;
    let value = serde_json::to_value(t).map_err(|e| e.to_string())?;
    store.set(THRESHOLDS_SETTING, value);
    store.save().map_err(|e| e.to_string())
}

fn store_bucket(app: &AppHandle, c: &ClosedMemoryBucket) {
    let state = app.state::<Thermal>();
    let guard = state.store.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(store) = guard.as_ref() {
        if let Err(e) =
            store.insert_memory_bucket(&c.bucket, &local_day(c.bucket.start_s), c.warning_minutes)
        {
            log::error!("memory: could not store a bucket ({e})");
        }
    }
}

impl MemorySampler {
    /// One memory tick, called from the thermal sampler's loop once it holds
    /// the sampler lock.
    pub fn tick(&mut self, app: &AppHandle) {
        let started = Instant::now();
        let reader = &mut self.reader;
        let last_top_bucket = &mut self.last_top_bucket;
        let obs = match gate(guard_wanted(app), &mut self.acc, || {
            let now = now_s();
            // `top` (root daemons, see topcmd.rs) runs at the first tick of
            // each bucket; the other ticks reuse its cached rows.
            let bucket = now - now.rem_euclid(BUCKET_SECS);
            let new_bucket = *last_top_bucket != Some(bucket);
            *last_top_bucket = Some(bucket);
            let top = topcmd::snapshot(now, new_bucket);
            observe(reader, now, &top)
        }) {
            Gate::Off(Some(closed)) => {
                store_bucket(app, &closed);
                return;
            }
            Gate::Off(None) => return,
            Gate::Unreadable => {
                log::warn!("memory: system figures unreadable; skipping this tick");
                return;
            }
            Gate::On(obs) => obs,
        };

        let thresholds = load_thresholds(app);
        let state = app.state::<Thermal>();
        let keys: Vec<(u32, u64)> = obs.procs.iter().map(|p| (p.pid, p.started_at)).collect();
        // Read before this tick's samples are written: a process seen for the
        // first time has no first sample yet, so it cannot be "growing".
        let first = {
            let guard = state.store.lock().unwrap_or_else(|e| e.into_inner());
            guard
                .as_ref()
                .map(|s| s.memory_first_samples(&keys))
                .transpose()
                .unwrap_or_else(|e| {
                    log::error!("memory: could not read first samples ({e})");
                    None
                })
                .unwrap_or_default()
        };
        let eval = evaluate(&obs.system, &obs.procs, &thresholds, &first);
        let closed = self.acc.push(&obs);

        {
            let guard = state.store.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(store) = guard.as_ref() {
                if let Err(e) = store.insert_memory_samples(obs.at_s, &obs.procs) {
                    log::error!("memory: could not store samples ({e})");
                }
                if let Some(c) = &closed {
                    if let Err(e) = store.insert_memory_bucket(
                        &c.bucket,
                        &local_day(c.bucket.start_s),
                        c.warning_minutes,
                    ) {
                        log::error!("memory: could not store a bucket ({e})");
                    }
                }
            }
        }

        if self.notify.should_notify(eval.verdict, obs.at_s) {
            use tauri_plugin_notification::NotificationExt;
            if let Err(e) = app
                .notification()
                .builder()
                .title("Your Mac is short on memory")
                .body(notification_body(&obs, &eval))
                .show()
            {
                log::warn!("memory: could not send the notification ({e})");
            }
        }

        // ADR 0008's budget (<= 1 % of one core) covers both guards; this is
        // how it is checked, once an hour so the log stays quiet.
        let cost = started.elapsed();
        if self
            .last_cost_log
            .is_none_or(|t| t.elapsed() >= COST_LOG_EVERY)
        {
            self.last_cost_log = Some(Instant::now());
            log::debug!(
                "memory: tick took {cost:?} ({} processes sampled, verdict {:?})",
                obs.procs.len(),
                eval.verdict
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::memory::procs::ProcInfo;
    use crate::memory::reading::SystemMemory;
    use serde_json::json;
    use std::cell::Cell;
    use std::collections::HashMap;

    fn obs(at_s: i64, used: u64, swap: u64, pressure: MemoryPressure) -> Observation {
        Observation {
            at_s,
            system: SystemMemory {
                total_bytes: 24 * GIB,
                used_bytes: used,
                compressed_bytes: 0,
                swap_used_bytes: swap,
                swap_total_bytes: 20 * GIB,
                pressure,
            },
            procs: Vec::new(),
        }
    }

    fn calm(at_s: i64, used: u64, swap: u64) -> Observation {
        obs(at_s, used, swap, MemoryPressure::Normal)
    }

    #[test]
    fn readings_in_one_bucket_do_not_close_it() {
        let mut acc = MemoryAccumulator::default();
        assert!(acc.push(&calm(600, 1, 1)).is_none());
        assert!(acc.push(&calm(660, 1, 1)).is_none());
        assert!(acc.push(&calm(899, 1, 1)).is_none());
    }

    #[test]
    fn a_reading_in_a_new_bucket_closes_the_open_one_aligned_to_300() {
        let mut acc = MemoryAccumulator::default();
        acc.push(&calm(610, 100, 10));
        acc.push(&calm(670, 300, 30));
        let closed = acc
            .push(&calm(905, 500, 50))
            .expect("closes the 600 bucket");
        let b = closed.bucket;
        assert_eq!(b.start_s, 600);
        assert_eq!(b.samples, 2);
        assert_eq!(b.used_avg, 200.0);
        assert_eq!(b.used_max, 300);
        assert_eq!(b.swap_avg, 20.0);
        assert_eq!(b.swap_max, 30);
        assert_eq!(b.worst_pressure, MemoryPressure::Normal);
        assert_eq!(closed.warning_minutes, 0);
        // The new reading started the 900 bucket.
        let next = acc.take().unwrap().bucket;
        assert_eq!(next.start_s, 900);
        assert_eq!(next.samples, 1);
    }

    #[test]
    fn worst_pressure_and_warning_minutes_are_counted() {
        let mut acc = MemoryAccumulator::default();
        acc.push(&obs(0, 1, 1, MemoryPressure::Warning));
        acc.push(&obs(60, 1, 1, MemoryPressure::Critical));
        acc.push(&obs(120, 1, 1, MemoryPressure::Normal));
        let closed = acc.take().unwrap();
        assert_eq!(closed.bucket.worst_pressure, MemoryPressure::Critical);
        assert_eq!(closed.warning_minutes, 2);
    }

    #[test]
    fn take_on_an_empty_accumulator_is_none() {
        assert!(MemoryAccumulator::default().take().is_none());
    }

    #[test]
    fn stop_notification_is_rate_limited_to_one_per_window() {
        let mut n = StopNotifyPolicy::default();
        let stop = MemoryVerdict::Stop;
        assert!(n.should_notify(stop, 1000));
        assert!(!n.should_notify(stop, 1060), "suppressed inside the window");
        assert!(!n.should_notify(stop, 1000 + NOTIFY_WINDOW_SECS - 1));
        assert!(n.should_notify(stop, 1000 + NOTIFY_WINDOW_SECS));
        assert!(!n.should_notify(stop, 1000 + NOTIFY_WINDOW_SECS + 60));
    }

    #[test]
    fn only_stop_notifies() {
        let mut n = StopNotifyPolicy::default();
        assert!(!n.should_notify(MemoryVerdict::Ok, 0));
        assert!(!n.should_notify(MemoryVerdict::Watch, 0));
        assert_eq!(n.last_at, None);
    }

    #[test]
    fn the_gate_reads_nothing_while_the_guard_is_off() {
        let reads = Cell::new(0);
        let mut acc = MemoryAccumulator::default();
        acc.push(&calm(0, 5, 5));
        let g = gate(false, &mut acc, || {
            reads.set(reads.get() + 1);
            Some(calm(60, 1, 1))
        });
        assert_eq!(reads.get(), 0, "no read while off");
        let Gate::Off(Some(closed)) = g else {
            panic!("the open bucket is closed when the guard goes off");
        };
        assert_eq!(closed.bucket.samples, 1);
        assert!(acc.take().is_none(), "nothing lingers");
        assert_eq!(gate(false, &mut acc, || None), Gate::Off(None));
    }

    #[test]
    fn the_gate_reads_while_on_and_tolerates_an_unreadable_machine() {
        let mut acc = MemoryAccumulator::default();
        assert_eq!(gate(true, &mut acc, || None), Gate::Unreadable);
        let o = calm(60, 1, 1);
        assert_eq!(gate(true, &mut acc, || Some(o.clone())), Gate::On(o));
    }

    #[test]
    fn the_guard_setting_is_on_unless_explicitly_off() {
        assert_eq!(GUARD_SETTING, "memoryGuardEnabled");
        assert!(guard_enabled(None));
        assert!(guard_enabled(Some(&json!(true))));
        assert!(!guard_enabled(Some(&json!(false))));
    }

    fn proc(name: &str, footprint: u64) -> ProcInfo {
        ProcInfo {
            pid: 1101,
            started_at: 1,
            name: name.into(),
            path: None,
            uid: Some(0),
            footprint_bytes: footprint,
        }
    }

    #[test]
    fn the_body_names_the_reasons_and_the_process() {
        let mut o = obs(0, 20 * GIB, 19 * GIB, MemoryPressure::Normal);
        o.procs = vec![proc("zdpd", 16 * GIB)];
        let e = evaluate(
            &o.system,
            &o.procs,
            &MemoryThresholds::default(),
            &HashMap::new(),
        );
        assert_eq!(e.verdict, MemoryVerdict::Stop);
        assert_eq!(
            notification_body(&o, &e),
            "Swap is 95% full; zdpd uses 16.0 GB. Open chapay's Memory tab."
        );
    }

    #[test]
    fn the_body_for_critical_pressure_alone() {
        let o = obs(0, 20 * GIB, 0, MemoryPressure::Critical);
        let e = evaluate(
            &o.system,
            &[],
            &MemoryThresholds::default(),
            &HashMap::new(),
        );
        assert_eq!(
            notification_body(&o, &e),
            "Memory pressure is critical. Open chapay's Memory tab."
        );
    }

    /// Times the work of one memory tick's read (system figures plus the
    /// footprint of every process). Run with
    /// `cargo test memory_tick_cost -- --ignored --nocapture`.
    #[test]
    #[ignore = "timing probe"]
    fn memory_tick_cost_is_printed() {
        let mut reader = ProcessReader::new();
        for i in 0..5 {
            let t = Instant::now();
            let o = observe(&mut reader, now_s(), &[]).expect("readable");
            let read = t.elapsed();
            let t2 = Instant::now();
            let e = evaluate(
                &o.system,
                &o.procs,
                &MemoryThresholds::default(),
                &HashMap::new(),
            );
            println!(
                "tick {i}: read {read:?} ({} procs, top {} = {}), evaluate {:?}, verdict {:?}",
                o.procs.len(),
                o.procs.first().map_or("-", |p| p.name.as_str()),
                o.procs.first().map_or(0, |p| p.footprint_bytes / (1 << 20)),
                t2.elapsed(),
                e.verdict
            );
        }
    }
}
