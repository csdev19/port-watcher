//! The verdict: four signals with editable thresholds, folded into OK / WATCH
//! / STOP (ADR 0011; the table is in the spec's "Verdict" section). Pure
//! functions over plain data, so every rule is a unit test.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use super::procs::ProcInfo;
use super::reading::{MemoryPressure, SystemMemory};

pub const GIB: u64 = 1024 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum MemoryVerdict {
    Ok,
    Watch,
    Stop,
}

/// What can make the verdict worse. The declaration order is the order
/// `reasons` are listed in (spec table).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum MemorySignal {
    Pressure,
    Swap,
    BigProcess,
    Growing,
}

/// The numbers behind the signals; stored in `settings.json` under
/// `memoryThresholds` and edited in Settings › Memory.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct MemoryThresholds {
    /// Swap used, as a percentage of the swap space macOS has allocated, at or
    /// above which the verdict is at least WATCH.
    pub swap_watch_pct: f64,
    /// Swap percentage that, together with a big process, is STOP.
    pub swap_stop_pct: f64,
    /// A process at or above this percentage of physical RAM is "big".
    pub big_process_pct: f64,
    /// A process is "growing" once its footprint is this many times its first
    /// retained sample...
    pub growth_factor: f64,
    /// ...and exceeds this many bytes.
    pub growth_min_bytes: u64,
}

impl Default for MemoryThresholds {
    fn default() -> Self {
        MemoryThresholds {
            swap_watch_pct: 80.0,
            swap_stop_pct: 95.0,
            big_process_pct: 25.0,
            growth_factor: 2.0,
            growth_min_bytes: 2 * GIB,
        }
    }
}

impl MemoryThresholds {
    /// Whether the numbers make sense: percentages in `(0, 100]`, a growth
    /// factor above 1 (at 1 every process would be "growing") and finite values.
    pub fn is_valid(&self) -> bool {
        let pct = |v: f64| v.is_finite() && v > 0.0 && v <= 100.0;
        pct(self.swap_watch_pct)
            && pct(self.swap_stop_pct)
            && pct(self.big_process_pct)
            && self.growth_factor.is_finite()
            && self.growth_factor > 1.0
    }

    /// The stored value, or the defaults when it is missing, not an object or
    /// invalid. Fields missing from a stored object keep their default.
    pub fn from_stored(stored: Option<&serde_json::Value>) -> Self {
        stored
            .and_then(|v| serde_json::from_value::<MemoryThresholds>(v.clone()).ok())
            .filter(MemoryThresholds::is_valid)
            .unwrap_or_default()
    }
}

/// A process's first retained sample in the same incarnation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FirstSample {
    pub footprint_bytes: u64,
    pub at_s: i64,
}

/// First retained samples by incarnation: `(pid, started_at)`. PID reuse
/// gives a different key, so growth is never compared across processes.
pub type FirstSamples = HashMap<(u32, u64), FirstSample>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Evaluation {
    pub verdict: MemoryVerdict,
    pub reasons: Vec<MemorySignal>,
    /// One entry per input process, in order: a subset of
    /// `BigProcess` / `Growing`.
    pub flags: Vec<Vec<MemorySignal>>,
}

fn swap_pct(system: &SystemMemory) -> Option<f64> {
    (system.swap_total_bytes > 0)
        .then(|| system.swap_used_bytes as f64 / system.swap_total_bytes as f64 * 100.0)
}

fn is_big(p: &ProcInfo, system: &SystemMemory, t: &MemoryThresholds) -> bool {
    system.total_bytes > 0
        && p.footprint_bytes as f64 / system.total_bytes as f64 * 100.0 >= t.big_process_pct
}

fn is_growing(p: &ProcInfo, first: &FirstSamples, t: &MemoryThresholds) -> bool {
    let Some(f) = first.get(&(p.pid, p.started_at)) else {
        return false;
    };
    f.footprint_bytes > 0
        && p.footprint_bytes > t.growth_min_bytes
        && p.footprint_bytes as f64 >= f.footprint_bytes as f64 * t.growth_factor
}

/// Folds the system figures and the process list into a verdict.
pub fn evaluate(
    system: &SystemMemory,
    procs: &[ProcInfo],
    t: &MemoryThresholds,
    first: &FirstSamples,
) -> Evaluation {
    let flags: Vec<Vec<MemorySignal>> = procs
        .iter()
        .map(|p| {
            let mut f = Vec::new();
            if is_big(p, system, t) {
                f.push(MemorySignal::BigProcess);
            }
            if is_growing(p, first, t) {
                f.push(MemorySignal::Growing);
            }
            f
        })
        .collect();
    let any = |s: MemorySignal| flags.iter().any(|f| f.contains(&s));

    let swap = swap_pct(system);
    let pressure = system.pressure >= MemoryPressure::Warning;
    let swap_watch = swap.is_some_and(|p| p >= t.swap_watch_pct);
    let big = any(MemorySignal::BigProcess);
    let growing = any(MemorySignal::Growing);

    let reasons: Vec<MemorySignal> = [
        (pressure, MemorySignal::Pressure),
        (swap_watch, MemorySignal::Swap),
        (big, MemorySignal::BigProcess),
        (growing, MemorySignal::Growing),
    ]
    .into_iter()
    .filter_map(|(fired, s)| fired.then_some(s))
    .collect();

    let stop = system.pressure == MemoryPressure::Critical
        || (swap.is_some_and(|p| p >= t.swap_stop_pct) && big);
    let verdict = if stop {
        MemoryVerdict::Stop
    } else if reasons.is_empty() {
        MemoryVerdict::Ok
    } else {
        MemoryVerdict::Watch
    };
    Evaluation {
        verdict,
        reasons,
        flags,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const TOTAL: u64 = 24 * GIB;

    fn system(pressure: MemoryPressure, swap_used_gib: u64) -> SystemMemory {
        SystemMemory {
            total_bytes: TOTAL,
            used_bytes: 20 * GIB,
            compressed_bytes: 5 * GIB,
            swap_used_bytes: swap_used_gib * GIB,
            swap_total_bytes: 20 * GIB,
            pressure,
        }
    }

    fn calm() -> SystemMemory {
        system(MemoryPressure::Normal, 0)
    }

    fn proc(pid: u32, started_at: u64, footprint: u64) -> ProcInfo {
        ProcInfo {
            pid,
            started_at,
            name: format!("p{pid}"),
            path: None,
            uid: Some(501),
            footprint_bytes: footprint,
        }
    }

    fn eval(s: &SystemMemory, procs: &[ProcInfo], first: &FirstSamples) -> Evaluation {
        evaluate(s, procs, &MemoryThresholds::default(), first)
    }

    fn first_of(pid: u32, started_at: u64, bytes: u64) -> FirstSamples {
        HashMap::from([(
            (pid, started_at),
            FirstSample {
                footprint_bytes: bytes,
                at_s: 1000,
            },
        )])
    }

    #[test]
    fn a_calm_machine_is_ok() {
        let e = eval(&calm(), &[proc(1000, 1, GIB)], &HashMap::new());
        assert_eq!(e.verdict, MemoryVerdict::Ok);
        assert!(e.reasons.is_empty());
        assert_eq!(e.flags, vec![Vec::<MemorySignal>::new()]);
    }

    #[test]
    fn pressure_warning_alone_is_watch() {
        let e = eval(&system(MemoryPressure::Warning, 0), &[], &HashMap::new());
        assert_eq!(e.verdict, MemoryVerdict::Watch);
        assert_eq!(e.reasons, vec![MemorySignal::Pressure]);
    }

    #[test]
    fn swap_at_the_watch_threshold_is_watch_and_below_it_is_ok() {
        // 16 of 20 GiB is exactly 80 %.
        let at = eval(&system(MemoryPressure::Normal, 16), &[], &HashMap::new());
        assert_eq!(at.verdict, MemoryVerdict::Watch);
        assert_eq!(at.reasons, vec![MemorySignal::Swap]);
        let below = eval(&system(MemoryPressure::Normal, 15), &[], &HashMap::new());
        assert_eq!(below.verdict, MemoryVerdict::Ok);
    }

    #[test]
    fn no_swap_file_is_not_a_swap_signal() {
        let mut s = calm();
        s.swap_total_bytes = 0;
        s.swap_used_bytes = 0;
        assert_eq!(eval(&s, &[], &HashMap::new()).verdict, MemoryVerdict::Ok);
    }

    #[test]
    fn a_process_over_a_quarter_of_ram_is_big_and_watch() {
        let big = proc(1000, 1, 6 * GIB); // exactly 25 % of 24 GiB
        let small = proc(1001, 1, 5 * GIB);
        let e = eval(&calm(), &[big, small], &HashMap::new());
        assert_eq!(e.verdict, MemoryVerdict::Watch);
        assert_eq!(e.reasons, vec![MemorySignal::BigProcess]);
        assert_eq!(e.flags[0], vec![MemorySignal::BigProcess]);
        assert!(e.flags[1].is_empty());
    }

    #[test]
    fn doubling_above_two_gib_is_growing() {
        let p = proc(1000, 1, 4 * GIB);
        let e = eval(&calm(), &[p], &first_of(1000, 1, 2 * GIB));
        assert_eq!(e.verdict, MemoryVerdict::Watch);
        assert_eq!(e.reasons, vec![MemorySignal::Growing]);
        assert_eq!(e.flags[0], vec![MemorySignal::Growing]);
    }

    #[test]
    fn growth_needs_both_the_factor_and_the_floor() {
        // Doubled, but still small: 300 MB to 900 MB.
        let small = proc(1000, 1, 900 * 1024 * 1024);
        let e = eval(&calm(), &[small], &first_of(1000, 1, 300 * 1024 * 1024));
        assert_eq!(e.verdict, MemoryVerdict::Ok);
        // Big, but only 1.5x: 3 GiB to 4.5 GiB.
        let slow = proc(1001, 1, 9 * GIB / 2);
        let e = eval(&calm(), &[slow], &first_of(1001, 1, 3 * GIB));
        assert_eq!(e.verdict, MemoryVerdict::Ok);
    }

    #[test]
    fn a_process_with_no_retained_sample_is_never_growing() {
        let e = eval(&calm(), &[proc(1000, 1, 5 * GIB)], &HashMap::new());
        assert!(e.flags[0].is_empty());
    }

    #[test]
    fn a_reused_pid_starts_a_fresh_series() {
        // pid 1000 had 1 GiB at start time 1; a new process took the PID at
        // start time 2 and now holds 3 GiB. Against the old series that
        // would be 3x; it must not count.
        let old_series = first_of(1000, 1, GIB);
        let reused = proc(1000, 2, 3 * GIB);
        let e = eval(&calm(), &[reused], &old_series);
        assert!(e.flags[0].is_empty());
        assert_eq!(e.verdict, MemoryVerdict::Ok);
        // The same process under its own series does count.
        let own = first_of(1000, 2, GIB);
        let e = eval(&calm(), &[proc(1000, 2, 3 * GIB)], &own);
        assert_eq!(e.flags[0], vec![MemorySignal::Growing]);
    }

    #[test]
    fn critical_pressure_alone_is_stop() {
        let e = eval(&system(MemoryPressure::Critical, 0), &[], &HashMap::new());
        assert_eq!(e.verdict, MemoryVerdict::Stop);
        assert_eq!(e.reasons, vec![MemorySignal::Pressure]);
    }

    #[test]
    fn swap_near_full_with_a_big_process_is_stop_but_swap_alone_is_not() {
        // The 2026-11-06 state: swap at 95 %+ and one 16 GiB process.
        let s = system(MemoryPressure::Normal, 19); // 95 %
        let zdpd = proc(1101, 1, 16 * GIB);
        let e = eval(&s, &[zdpd], &HashMap::new());
        assert_eq!(e.verdict, MemoryVerdict::Stop);
        assert_eq!(
            e.reasons,
            vec![MemorySignal::Swap, MemorySignal::BigProcess]
        );

        let alone = eval(&s, &[proc(1101, 1, GIB)], &HashMap::new());
        assert_eq!(alone.verdict, MemoryVerdict::Watch);
        assert_eq!(alone.reasons, vec![MemorySignal::Swap]);
    }

    #[test]
    fn reasons_follow_the_spec_order() {
        let s = system(MemoryPressure::Warning, 17);
        let p = proc(1000, 1, 8 * GIB);
        let e = eval(&s, &[p], &first_of(1000, 1, 3 * GIB));
        assert_eq!(
            e.reasons,
            vec![
                MemorySignal::Pressure,
                MemorySignal::Swap,
                MemorySignal::BigProcess,
                MemorySignal::Growing
            ]
        );
        assert_eq!(e.verdict, MemoryVerdict::Watch);
    }

    #[test]
    fn stored_thresholds_override_the_defaults() {
        let stored = json!({
            "swapWatchPct": 50, "swapStopPct": 60, "bigProcessPct": 10,
            "growthFactor": 3, "growthMinBytes": 1024
        });
        let t = MemoryThresholds::from_stored(Some(&stored));
        assert_eq!(t.swap_watch_pct, 50.0);
        assert_eq!(t.growth_min_bytes, 1024);
        // 12 of 20 GiB is 60 % of swap, and a 3 GiB process is 12.5 % of RAM.
        let s = system(MemoryPressure::Normal, 12);
        let e = evaluate(&s, &[proc(1000, 1, 3 * GIB)], &t, &HashMap::new());
        assert_eq!(e.verdict, MemoryVerdict::Stop);
        // The defaults would call the same state OK.
        let d = eval(&s, &[proc(1000, 1, 3 * GIB)], &HashMap::new());
        assert_eq!(d.verdict, MemoryVerdict::Ok);
    }

    #[test]
    fn missing_partial_or_invalid_stored_thresholds_fall_back() {
        let d = MemoryThresholds::default();
        assert_eq!(MemoryThresholds::from_stored(None), d);
        assert_eq!(MemoryThresholds::from_stored(Some(&json!("junk"))), d);
        let partial = MemoryThresholds::from_stored(Some(&json!({ "swapWatchPct": 70 })));
        assert_eq!(partial.swap_watch_pct, 70.0);
        assert_eq!(partial.swap_stop_pct, d.swap_stop_pct);
        // A growth factor of 1 would flag every process; refused.
        let bad = json!({ "growthFactor": 1 });
        assert_eq!(MemoryThresholds::from_stored(Some(&bad)), d);
        let bad = json!({ "swapWatchPct": 0 });
        assert_eq!(MemoryThresholds::from_stored(Some(&bad)), d);
        assert!(!MemoryThresholds {
            swap_stop_pct: 101.0,
            ..d
        }
        .is_valid());
    }

    #[test]
    fn enums_serialize_as_the_contract_strings() {
        assert_eq!(
            serde_json::to_value(MemorySignal::BigProcess).unwrap(),
            json!("bigProcess")
        );
        assert_eq!(
            serde_json::to_value(MemoryVerdict::Stop).unwrap(),
            json!("stop")
        );
        let t = serde_json::to_value(MemoryThresholds::default()).unwrap();
        assert_eq!(t["growthMinBytes"], json!(2_147_483_648u64));
        assert_eq!(t["swapWatchPct"], json!(80.0));
    }
}
