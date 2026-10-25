//! Delivery policy for native notifications (ADR 0011). Pure: the clock is injected.
//!
//! - A rule that fires gets one notification, never one per tick.
//! - Each alert key (a rule, or a watched port) has a 15 minute cooldown. A re-fire inside it
//!   updates the band only.
//! - At most 4 notifications per hour overall.
//! - None while the panel is visible: the band is already in front of the user, and the
//!   suppressed notification does not use up the cooldown or the hourly budget.

use std::collections::{HashMap, VecDeque};
use std::time::{Duration, Instant};

pub const COOLDOWN: Duration = Duration::from_secs(15 * 60);
pub const HOURLY_CAP: usize = 4;
const HOUR: Duration = Duration::from_secs(60 * 60);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Decision {
    Notify,
    PanelVisible,
    Cooldown,
    HourlyCap,
}

#[derive(Debug, Default)]
pub struct Policy {
    last: HashMap<String, Instant>,
    sent: VecDeque<Instant>,
}

impl Policy {
    /// Decides, and when it says `Notify` records the notification.
    pub fn decide(&mut self, key: &str, now: Instant, panel_visible: bool) -> Decision {
        if panel_visible {
            return Decision::PanelVisible;
        }
        if self
            .last
            .get(key)
            .is_some_and(|at| now.saturating_duration_since(*at) < COOLDOWN)
        {
            return Decision::Cooldown;
        }
        while self
            .sent
            .front()
            .is_some_and(|at| now.saturating_duration_since(*at) >= HOUR)
        {
            self.sent.pop_front();
        }
        if self.sent.len() >= HOURLY_CAP {
            return Decision::HourlyCap;
        }
        self.sent.push_back(now);
        self.last.insert(key.to_string(), now);
        Decision::Notify
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mins(m: u64) -> Duration {
        Duration::from_secs(m * 60)
    }

    #[test]
    fn the_first_firing_notifies_and_a_refire_inside_the_cooldown_does_not() {
        let t0 = Instant::now();
        let mut p = Policy::default();
        assert_eq!(p.decide("a", t0, false), Decision::Notify);
        assert_eq!(p.decide("a", t0 + mins(14), false), Decision::Cooldown);
        assert_eq!(p.decide("a", t0 + mins(15), false), Decision::Notify);
    }

    #[test]
    fn keys_have_independent_cooldowns() {
        let t0 = Instant::now();
        let mut p = Policy::default();
        assert_eq!(p.decide("thermal", t0, false), Decision::Notify);
        assert_eq!(p.decide("port:5173", t0 + mins(1), false), Decision::Notify);
    }

    #[test]
    fn no_more_than_four_per_hour_then_the_budget_slides() {
        let t0 = Instant::now();
        let mut p = Policy::default();
        for (i, key) in ["a", "b", "c", "d"].into_iter().enumerate() {
            assert_eq!(p.decide(key, t0 + mins(i as u64), false), Decision::Notify);
        }
        assert_eq!(p.decide("e", t0 + mins(5), false), Decision::HourlyCap);
        // The first one leaves the window at t0 + 60 min.
        assert_eq!(p.decide("e", t0 + mins(60), false), Decision::Notify);
    }

    #[test]
    fn a_visible_panel_suppresses_without_spending_cooldown_or_budget() {
        let t0 = Instant::now();
        let mut p = Policy::default();
        assert_eq!(p.decide("a", t0, true), Decision::PanelVisible);
        assert_eq!(p.decide("a", t0 + mins(1), false), Decision::Notify);
        for i in 0..10 {
            p.decide("b", t0 + mins(i), true);
        }
        assert_eq!(p.decide("c", t0 + mins(2), false), Decision::Notify);
    }

    #[test]
    fn a_cooldown_hit_does_not_extend_the_cooldown() {
        let t0 = Instant::now();
        let mut p = Policy::default();
        p.decide("a", t0, false);
        assert_eq!(p.decide("a", t0 + mins(10), false), Decision::Cooldown);
        assert_eq!(p.decide("a", t0 + mins(15), false), Decision::Notify);
    }
}
