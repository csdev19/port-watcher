//! A bounded ring of recent samples, kept in Rust so the full window (Phase 6) and the alert
//! rules (Phase 5) can read the same series as the panel.
//!
//! Points are evicted by capacity and by age (older than one hour before the newest point), so
//! sparse points taken while the panel is closed never push out the last hour.

use super::dto::HistoryPoint;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;

/// One hour at 1 Hz.
pub const HISTORY_CAPACITY: usize = 3600;
/// Points older than this, measured from the newest point, are dropped.
pub const MAX_AGE_MS: u64 = 3_600_000;

/// The heaviest process when a point was taken, so a peak can say who caused it.
#[derive(Debug, Clone, PartialEq)]
pub struct TopProc {
    pub name: String,
    pub cpu_pct: f32,
}

struct Entry {
    point: HistoryPoint,
    top: Option<TopProc>,
}

pub struct History {
    buf: VecDeque<Entry>,
    cap: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Metric {
    Cpu,
    Gpu,
    MemoryUsed,
    Hotspot,
    ThermalLevel,
}

impl Metric {
    fn value(self, p: &HistoryPoint) -> Option<f32> {
        match self {
            Metric::Cpu => p.cpu,
            Metric::Gpu => p.gpu,
            Metric::MemoryUsed => Some(p.mem_used_pct),
            Metric::Hotspot => p.heat,
            Metric::ThermalLevel => p.heat_level.map(f32::from),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Range {
    #[serde(rename = "1m")]
    OneMin,
    #[serde(rename = "10m")]
    TenMin,
    #[serde(rename = "1h")]
    OneHour,
}

impl Range {
    /// (bucket width in ms, bucket count): 60 x 1 s, 120 x 5 s, 180 x 20 s.
    pub fn buckets(self) -> (u64, usize) {
        match self {
            Range::OneMin => (1_000, 60),
            Range::TenMin => (5_000, 120),
            Range::OneHour => (20_000, 180),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Bucket {
    /// End of the bucket's time slot.
    pub t_ms: u64,
    pub min: f32,
    pub avg: f32,
    pub max: f32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Peak {
    pub t_ms: u64,
    pub value: f32,
    pub top: Option<TopProc>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Series {
    pub metric: Metric,
    pub range: Range,
    pub bucket_ms: u64,
    pub end_ms: u64,
    /// `None` means chapay did not sample that slot.
    pub buckets: Vec<Option<Bucket>>,
    pub peak: Option<Peak>,
}

impl History {
    pub fn new(cap: usize) -> Self {
        Self {
            buf: VecDeque::with_capacity(cap.min(HISTORY_CAPACITY)),
            cap: cap.max(1),
        }
    }

    #[cfg(test)]
    pub fn push(&mut self, point: HistoryPoint) {
        self.push_with_top(point, None);
    }

    pub fn push_with_top(&mut self, point: HistoryPoint, top: Option<TopProc>) {
        if self.buf.len() == self.cap {
            self.buf.pop_front();
        }
        let newest = point.at_ms;
        self.buf.push_back(Entry { point, top });
        while self
            .buf
            .front()
            .is_some_and(|e| newest.saturating_sub(e.point.at_ms) > MAX_AGE_MS)
        {
            self.buf.pop_front();
        }
    }

    /// Points taken at or after `since_ms`, oldest first.
    pub fn since(&self, since_ms: u64) -> Vec<HistoryPoint> {
        self.buf
            .iter()
            .filter(|e| e.point.at_ms >= since_ms)
            .map(|e| e.point)
            .collect()
    }

    /// `metric` over `range`, ending at `now_ms`, in fixed buckets. Slots with no point stay
    /// `None`; nothing is interpolated. Pure.
    pub fn series(&self, metric: Metric, range: Range, now_ms: u64) -> Series {
        let (bucket_ms, n) = range.buckets();
        let start = now_ms.saturating_sub(bucket_ms * n as u64);
        let mut acc: Vec<Option<(f32, f32, f64, u32)>> = vec![None; n];
        let mut peak: Option<Peak> = None;
        for e in &self.buf {
            let at = e.point.at_ms;
            if at < start || at >= now_ms {
                continue;
            }
            let Some(v) = metric.value(&e.point) else {
                continue;
            };
            let i = (((at - start) / bucket_ms) as usize).min(n - 1);
            acc[i] = Some(match acc[i] {
                None => (v, v, f64::from(v), 1),
                Some((lo, hi, sum, c)) => (lo.min(v), hi.max(v), sum + f64::from(v), c + 1),
            });
            if peak.as_ref().is_none_or(|p| v > p.value) {
                peak = Some(Peak {
                    t_ms: at,
                    value: v,
                    top: e.top.clone(),
                });
            }
        }
        let buckets = acc
            .into_iter()
            .enumerate()
            .map(|(i, a)| {
                a.map(|(min, max, sum, c)| Bucket {
                    t_ms: start + (i as u64 + 1) * bucket_ms,
                    min,
                    avg: (sum / f64::from(c)) as f32,
                    max,
                })
            })
            .collect();
        Series {
            metric,
            range,
            bucket_ms,
            end_ms: now_ms,
            buckets,
            peak,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn point(at_ms: u64) -> HistoryPoint {
        HistoryPoint {
            at_ms,
            cpu: Some(1.0),
            gpu: None,
            heat: None,
            heat_level: None,
            mem_used_pct: 50.0,
        }
    }

    #[test]
    fn wraps_at_capacity_dropping_the_oldest() {
        let mut h = History::new(3);
        for t in 1..=5 {
            h.push(point(t));
        }
        assert_eq!(h.since(0).len(), 3);
        let times: Vec<u64> = h.since(0).iter().map(|p| p.at_ms).collect();
        assert_eq!(times, [3, 4, 5]);
    }

    #[test]
    fn since_includes_the_boundary_and_keeps_order() {
        let mut h = History::new(10);
        for t in [100, 200, 300] {
            h.push(point(t));
        }
        let times: Vec<u64> = h.since(200).iter().map(|p| p.at_ms).collect();
        assert_eq!(times, [200, 300]);
        assert!(h.since(301).is_empty());
    }

    fn cpu_at(at_ms: u64, cpu: Option<f32>) -> HistoryPoint {
        HistoryPoint {
            cpu,
            ..point(at_ms)
        }
    }

    #[test]
    fn evicts_by_age_so_sparse_points_keep_the_last_hour() {
        let mut h = History::new(HISTORY_CAPACITY);
        // One point every 30 s for two hours.
        for i in 0..240u64 {
            h.push(point(i * 30_000));
        }
        let newest = 239 * 30_000;
        let kept = h.since(0);
        assert!(kept.iter().all(|p| newest - p.at_ms <= MAX_AGE_MS));
        assert_eq!(kept.len(), 121, "an hour of 30 s points, boundary included");
    }

    #[test]
    fn one_hertz_for_ten_minutes_fills_every_five_second_bucket() {
        let mut h = History::new(HISTORY_CAPACITY);
        let now = 1_000_000u64;
        for s in 1..=600u64 {
            h.push(cpu_at(now - 600_000 + s * 1000 - 500, Some(10.0)));
        }
        let s = h.series(Metric::Cpu, Range::TenMin, now);
        assert_eq!(s.buckets.len(), 120);
        assert!(s.buckets.iter().all(Option::is_some));
        assert_eq!(s.bucket_ms, 5_000);
    }

    #[test]
    fn a_hole_stays_none_and_is_never_interpolated() {
        let mut h = History::new(HISTORY_CAPACITY);
        let now = 2_000_000u64;
        h.push(cpu_at(now - 1_100_000, Some(5.0)));
        h.push(cpu_at(now - 5_000, Some(7.0)));
        let s = h.series(Metric::Cpu, Range::OneHour, now);
        let filled = s.buckets.iter().filter(|b| b.is_some()).count();
        assert_eq!(filled, 2);
        assert!(s.buckets[100].is_none());
    }

    #[test]
    fn buckets_report_min_avg_max_and_skip_missing_values() {
        let mut h = History::new(10);
        let now = 100_000u64;
        h.push(cpu_at(now - 900, Some(10.0)));
        h.push(cpu_at(now - 800, Some(30.0)));
        h.push(cpu_at(now - 700, None));
        let s = h.series(Metric::Cpu, Range::OneMin, now);
        let b = s.buckets[59].unwrap();
        assert_eq!((b.min, b.avg, b.max), (10.0, 20.0, 30.0));
        assert_eq!(b.t_ms, now);
    }

    #[test]
    fn the_peak_carries_who_was_heaviest() {
        let mut h = History::new(10);
        let now = 100_000u64;
        h.push_with_top(
            cpu_at(now - 3000, Some(40.0)),
            Some(TopProc {
                name: "Cursor".into(),
                cpu_pct: 38.0,
            }),
        );
        h.push_with_top(cpu_at(now - 2000, Some(90.0)), None);
        h.push_with_top(
            cpu_at(now - 1000, Some(97.0)),
            Some(TopProc {
                name: "ollama".into(),
                cpu_pct: 95.0,
            }),
        );
        h.push(cpu_at(now - 500, Some(20.0)));
        let p = h.series(Metric::Cpu, Range::OneMin, now).peak.unwrap();
        assert_eq!((p.t_ms, p.value), (now - 1000, 97.0));
        assert_eq!(p.top.unwrap().name, "ollama");
    }

    #[test]
    fn points_outside_the_range_are_ignored() {
        let mut h = History::new(10);
        h.push(cpu_at(1_000, Some(50.0)));
        let s = h.series(Metric::Cpu, Range::OneMin, 500_000);
        assert!(s.buckets.iter().all(Option::is_none));
        assert!(s.peak.is_none());
    }

    #[test]
    fn metric_and_range_use_the_wire_names() {
        assert_eq!(
            serde_json::to_value(Metric::MemoryUsed).unwrap(),
            "memoryUsed"
        );
        assert_eq!(
            serde_json::to_value(Metric::ThermalLevel).unwrap(),
            "thermalLevel"
        );
        assert_eq!(serde_json::to_value(Range::TenMin).unwrap(), "10m");
        let r: Range = serde_json::from_str("\"1h\"").unwrap();
        assert_eq!(r, Range::OneHour);
    }
}
