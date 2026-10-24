//! A bounded ring of recent samples, kept in Rust so the full window (Phase 6) and the alert
//! rules (Phase 5) can read the same series as the panel.

use super::dto::HistoryPoint;
use std::collections::VecDeque;

/// One hour at 1 Hz.
pub const HISTORY_CAPACITY: usize = 3600;

pub struct History {
    buf: VecDeque<HistoryPoint>,
    cap: usize,
}

impl History {
    pub fn new(cap: usize) -> Self {
        Self {
            buf: VecDeque::with_capacity(cap.min(HISTORY_CAPACITY)),
            cap: cap.max(1),
        }
    }

    pub fn push(&mut self, point: HistoryPoint) {
        if self.buf.len() == self.cap {
            self.buf.pop_front();
        }
        self.buf.push_back(point);
    }

    /// Points taken at or after `since_ms`, oldest first.
    pub fn since(&self, since_ms: u64) -> Vec<HistoryPoint> {
        self.buf
            .iter()
            .filter(|p| p.at_ms >= since_ms)
            .copied()
            .collect()
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
}
