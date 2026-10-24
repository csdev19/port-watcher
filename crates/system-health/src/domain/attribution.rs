//! Per-process attribution: turn two counter snapshots into ranked usage.

use serde::Serialize;
use std::collections::HashMap;

/// Cumulative counters of one process at one instant.
#[derive(Debug, Clone, PartialEq)]
pub struct ProcessCounters {
    pub pid: u32,
    pub name: String,
    /// Process start, in nanoseconds on the machine clock. Distinguishes a reused PID.
    pub started_at: u64,
    /// User + system CPU time, in nanoseconds.
    pub cpu_time_ns: u64,
    pub footprint_bytes: u64,
    /// Cumulative energy in nanojoules; `None` when the OS does not report it.
    pub energy_nj: Option<u64>,
    /// Executable path, when the OS reports it. Constant for one incarnation.
    pub path: Option<String>,
    /// Owner (effective) user id, when the OS reports it.
    pub uid: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessUsage {
    pub pid: u32,
    pub name: String,
    pub started_at: u64,
    /// Share of one core: 100 means one core fully busy, 250 means two and a half.
    pub cpu_pct: f32,
    pub footprint_bytes: u64,
    /// Average power over the interval. Label it "energy impact"; do not sum it to system watts.
    pub energy_mw: Option<f32>,
    /// Executable path, so a caller can group helpers under their app bundle.
    pub path: Option<String>,
    pub uid: Option<u32>,
    /// Share of the GPU's time this process used over the interval (0 to 100), summed over all
    /// its GPU clients. `None` when the OS does not report it for this process, or on the first
    /// reading. Undocumented IORegistry source; treat "no figure" as normal.
    pub gpu_pct: Option<f32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Sort {
    /// Keep the order the OS listed the processes in. With `n = usize::MAX` this returns every
    /// process, for callers that group them.
    None,
    Cpu,
    Mem,
    Energy,
}

/// Mach absolute time to nanoseconds. Apple Silicon has a 125/3 timebase.
pub fn ticks_to_ns(ticks: u64, numer: u32, denom: u32) -> u64 {
    if denom == 0 {
        return ticks;
    }
    ((ticks as u128 * numer as u128) / denom as u128).min(u64::MAX as u128) as u64
}

/// Per-PID GPU share from two cumulative GPU-time maps (nanoseconds) `dt_ns` apart. A PID
/// missing from either map, or whose counter went backwards (a client closed or the counter
/// reset), has no figure. A process can overlap work on several clients, so the share is capped
/// at 100.
pub fn gpu_pct_by_pid(
    prev: &HashMap<u32, u64>,
    curr: &HashMap<u32, u64>,
    dt_ns: f64,
) -> HashMap<u32, f32> {
    if dt_ns <= 0.0 {
        return HashMap::new();
    }
    curr.iter()
        .filter_map(|(pid, now)| {
            let before = prev.get(pid)?;
            let delta = now.checked_sub(*before)?;
            Some((*pid, (delta as f64 / dt_ns * 100.0).min(100.0) as f32))
        })
        .collect()
}

/// Ranks processes by `sort`, top `n`. A process missing from `prev`, or whose start time
/// changed (a reused PID), appears with no delta: 0 % CPU and no energy figure. A process
/// missing from `curr` is dropped. `dt_ms` is the time between the two snapshots.
pub fn rank(
    prev: &[ProcessCounters],
    curr: &[ProcessCounters],
    dt_ms: u64,
    sort: Sort,
    n: usize,
) -> Vec<ProcessUsage> {
    let before: HashMap<u32, &ProcessCounters> = prev.iter().map(|p| (p.pid, p)).collect();
    let dt_ns = dt_ms as f64 * 1_000_000.0;
    let mut rows: Vec<ProcessUsage> = curr
        .iter()
        .map(|c| {
            let base = before.get(&c.pid).filter(|p| p.started_at == c.started_at);
            let (cpu_pct, energy_mw) = match base {
                Some(p) if dt_ns > 0.0 => {
                    let cpu = c.cpu_time_ns.saturating_sub(p.cpu_time_ns) as f64 / dt_ns * 100.0;
                    let energy = match (c.energy_nj, p.energy_nj) {
                        // nJ per ns is W; x1000 is mW.
                        (Some(a), Some(b)) => {
                            Some((a.saturating_sub(b) as f64 / dt_ns * 1000.0) as f32)
                        }
                        _ => None,
                    };
                    (cpu as f32, energy)
                }
                _ => (0.0, None),
            };
            ProcessUsage {
                pid: c.pid,
                name: c.name.clone(),
                started_at: c.started_at,
                cpu_pct,
                footprint_bytes: c.footprint_bytes,
                energy_mw,
                path: c.path.clone(),
                uid: c.uid,
                gpu_pct: None,
            }
        })
        .collect();
    let key = |u: &ProcessUsage| -> f64 {
        match sort {
            Sort::None => 0.0,
            Sort::Cpu => u.cpu_pct as f64,
            Sort::Mem => u.footprint_bytes as f64,
            Sort::Energy => u.energy_mw.unwrap_or(0.0) as f64,
        }
    };
    if sort != Sort::None {
        rows.sort_by(|a, b| key(b).total_cmp(&key(a)).then(a.pid.cmp(&b.pid)));
    }
    rows.truncate(n);
    rows
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(
        pid: u32,
        started_at: u64,
        cpu_ms: u64,
        mem: u64,
        energy_nj: Option<u64>,
    ) -> ProcessCounters {
        ProcessCounters {
            pid,
            name: format!("p{pid}"),
            started_at,
            cpu_time_ns: cpu_ms * 1_000_000,
            footprint_bytes: mem,
            energy_nj,
            path: Some(format!("/bin/p{pid}")),
            uid: Some(501),
        }
    }

    #[test]
    fn cpu_pct_from_two_snapshots() {
        let prev = [p(1, 10, 100, 1, Some(0))];
        let curr = [p(1, 10, 600, 1, Some(2_000_000_000))];
        let r = rank(&prev, &curr, 1000, Sort::Cpu, 5);
        assert_eq!(r[0].cpu_pct, 50.0);
        // 2e9 nJ over 1 s = 2 W = 2000 mW
        assert_eq!(r[0].energy_mw, Some(2000.0));
    }

    #[test]
    fn multi_core_use_exceeds_100() {
        let prev = [p(1, 10, 0, 1, None)];
        let curr = [p(1, 10, 2500, 1, None)];
        assert_eq!(rank(&prev, &curr, 1000, Sort::Cpu, 5)[0].cpu_pct, 250.0);
    }

    #[test]
    fn reused_pid_gets_a_fresh_row_without_delta() {
        let prev = [p(7, 10, 9000, 1, Some(5))];
        let curr = [p(7, 99, 100, 1, Some(9))];
        let r = rank(&prev, &curr, 1000, Sort::Cpu, 5);
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].cpu_pct, 0.0);
        assert_eq!(r[0].energy_mw, None);
    }

    #[test]
    fn new_pid_has_no_delta_and_vanished_pid_is_dropped() {
        let prev = [p(1, 1, 0, 1, None), p(2, 1, 0, 1, None)];
        let curr = [p(2, 1, 500, 1, None), p(3, 1, 500, 1, None)];
        let r = rank(&prev, &curr, 1000, Sort::Cpu, 5);
        let pids: Vec<u32> = r.iter().map(|u| u.pid).collect();
        assert_eq!(pids, [2, 3]);
        assert_eq!(r[0].cpu_pct, 50.0);
        assert_eq!(r[1].cpu_pct, 0.0);
    }

    #[test]
    fn sorts_by_cpu_mem_and_energy() {
        let prev = [
            p(1, 1, 0, 0, Some(0)),
            p(2, 1, 0, 0, Some(0)),
            p(3, 1, 0, 0, Some(0)),
        ];
        let curr = [
            p(1, 1, 900, 10, Some(1_000)),
            p(2, 1, 100, 30, Some(9_000)),
            p(3, 1, 500, 20, Some(5_000)),
        ];
        let order = |s| {
            rank(&prev, &curr, 1000, s, 3)
                .iter()
                .map(|u| u.pid)
                .collect::<Vec<_>>()
        };
        assert_eq!(order(Sort::Cpu), [1, 3, 2]);
        assert_eq!(order(Sort::Mem), [2, 3, 1]);
        assert_eq!(order(Sort::Energy), [2, 3, 1]);
        assert_eq!(rank(&prev, &curr, 1000, Sort::Cpu, 1).len(), 1);
    }

    #[test]
    fn path_and_uid_are_carried_through() {
        let prev = [p(1, 1, 0, 1, None)];
        let curr = [p(1, 1, 500, 1, None)];
        let r = rank(&prev, &curr, 1000, Sort::Cpu, 5);
        assert_eq!(r[0].path.as_deref(), Some("/bin/p1"));
        assert_eq!(r[0].uid, Some(501));
    }

    #[test]
    fn sort_none_keeps_listing_order_and_returns_everything() {
        let curr = [
            p(9, 1, 900, 1, None),
            p(2, 1, 100, 1, None),
            p(5, 1, 500, 1, None),
        ];
        let r = rank(&[], &curr, 1000, Sort::None, usize::MAX);
        assert_eq!(r.iter().map(|u| u.pid).collect::<Vec<_>>(), [9, 2, 5]);
    }

    #[test]
    fn zero_interval_yields_no_rates() {
        let prev = [p(1, 1, 0, 1, Some(0))];
        let curr = [p(1, 1, 500, 1, Some(10))];
        let r = rank(&prev, &curr, 0, Sort::Cpu, 5);
        assert_eq!(r[0].cpu_pct, 0.0);
        assert_eq!(r[0].energy_mw, None);
    }

    #[test]
    fn gpu_share_from_two_readings() {
        let prev = HashMap::from([(1, 1_000_000_000), (2, 0), (3, 500)]);
        let curr = HashMap::from([(1, 1_100_000_000), (2, 5_000_000_000), (4, 9)]);
        let r = gpu_pct_by_pid(&prev, &curr, 1_000_000_000.0);
        assert!((r[&1] - 10.0).abs() < 1e-3);
        assert_eq!(r[&2], 100.0, "capped");
        assert!(!r.contains_key(&3), "gone");
        assert!(!r.contains_key(&4), "no baseline");
    }

    #[test]
    fn gpu_counter_reset_and_zero_interval_give_no_figure() {
        let prev = HashMap::from([(1, 900)]);
        let curr = HashMap::from([(1, 100)]);
        assert!(gpu_pct_by_pid(&prev, &curr, 1e9).is_empty());
        assert!(gpu_pct_by_pid(&curr, &prev, 0.0).is_empty());
    }

    #[test]
    fn timebase_math() {
        // Apple Silicon: 125/3 -> 24 ticks = 1000 ns
        assert_eq!(ticks_to_ns(24, 125, 3), 1000);
        assert_eq!(ticks_to_ns(1000, 1, 1), 1000);
        assert_eq!(ticks_to_ns(u64::MAX, 125, 3), u64::MAX);
        assert_eq!(ticks_to_ns(5, 125, 0), 5);
    }
}
