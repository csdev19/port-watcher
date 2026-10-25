//! CPU load from tick snapshots.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CoreKind {
    Performance,
    Efficiency,
    Unknown,
}

/// Cumulative ticks of one core: user, system, idle, nice.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CoreTicks {
    pub kind: CoreKind,
    pub ticks: [u32; 4],
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct CpuTicks {
    pub cores: Vec<CoreTicks>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoreLoad {
    pub index: u16,
    pub kind: CoreKind,
    pub pct: f32,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CpuLoad {
    pub total_pct: f32,
    pub cores: Vec<CoreLoad>,
}

impl CpuLoad {
    /// Average load of the cores of one kind, `None` if there are none.
    pub fn kind_pct(&self, kind: CoreKind) -> Option<f32> {
        let v: Vec<f32> = self
            .cores
            .iter()
            .filter(|c| c.kind == kind)
            .map(|c| c.pct)
            .collect();
        (!v.is_empty()).then(|| v.iter().sum::<f32>() / v.len() as f32)
    }
}

fn busy_pct(a: [u32; 4], b: [u32; 4]) -> f32 {
    let d: Vec<f64> = (0..4).map(|i| b[i].wrapping_sub(a[i]) as f64).collect();
    let total: f64 = d.iter().sum();
    if total == 0.0 {
        0.0
    } else {
        (100.0 * (total - d[2]) / total) as f32
    }
}

/// Load between two snapshots. `None` when the core count changed.
pub fn usage(prev: &CpuTicks, curr: &CpuTicks) -> Option<CpuLoad> {
    if prev.cores.len() != curr.cores.len() || curr.cores.is_empty() {
        return None;
    }
    let cores: Vec<CoreLoad> = prev
        .cores
        .iter()
        .zip(&curr.cores)
        .enumerate()
        .map(|(i, (p, c))| CoreLoad {
            index: i as u16,
            kind: c.kind,
            pct: busy_pct(p.ticks, c.ticks),
        })
        .collect();
    // Total = busy ticks over all ticks across cores (cores sample the same interval).
    let (mut busy, mut all) = (0f64, 0f64);
    for (p, c) in prev.cores.iter().zip(&curr.cores) {
        let d: Vec<f64> = (0..4)
            .map(|i| c.ticks[i].wrapping_sub(p.ticks[i]) as f64)
            .collect();
        let t: f64 = d.iter().sum();
        all += t;
        busy += t - d[2];
    }
    let total_pct = if all == 0.0 {
        0.0
    } else {
        (100.0 * busy / all) as f32
    };
    Some(CpuLoad { total_pct, cores })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t(kind: CoreKind, ticks: [u32; 4]) -> CoreTicks {
        CoreTicks { kind, ticks }
    }

    #[test]
    fn per_core_and_total() {
        let prev = CpuTicks {
            cores: vec![
                t(CoreKind::Efficiency, [0, 0, 0, 0]),
                t(CoreKind::Performance, [0, 0, 0, 0]),
            ],
        };
        let curr = CpuTicks {
            cores: vec![
                t(CoreKind::Efficiency, [50, 0, 50, 0]),
                t(CoreKind::Performance, [0, 0, 100, 0]),
            ],
        };
        let load = usage(&prev, &curr).unwrap();
        assert_eq!(load.cores[0].pct, 50.0);
        assert_eq!(load.cores[1].pct, 0.0);
        assert_eq!(load.total_pct, 25.0);
        assert_eq!(load.kind_pct(CoreKind::Efficiency), Some(50.0));
        assert_eq!(load.kind_pct(CoreKind::Unknown), None);
    }

    #[test]
    fn counter_wraparound_and_no_ticks() {
        let prev = CpuTicks {
            cores: vec![t(CoreKind::Unknown, [u32::MAX, 0, 0, 0])],
        };
        let curr = CpuTicks {
            cores: vec![t(CoreKind::Unknown, [9, 0, 0, 0])],
        };
        assert_eq!(usage(&prev, &curr).unwrap().total_pct, 100.0);
        assert_eq!(usage(&prev, &prev).unwrap().total_pct, 0.0);
    }

    #[test]
    fn mismatched_core_count_is_none() {
        let a = CpuTicks {
            cores: vec![t(CoreKind::Unknown, [0; 4])],
        };
        assert_eq!(usage(&a, &CpuTicks::default()), None);
    }
}
