//! "Watched port taken": the Ports context's own event (ADR 0011, ADR 0013). Pure: it is fed
//! the listeners of the watched ports and says which ones were just taken by something new.
//!
//! A port is *taken* when it was free (or held by a different program) and a listener now holds
//! it. Restarting your own dev server is not a take: the new listener has the same program and
//! project as the last owner seen on that port, so it stays silent. The first observation of a
//! port is only a baseline and never reports.

use std::collections::{BTreeMap, BTreeSet};

use super::models::PortEntry;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PortTaken {
    pub port: u16,
    pub pid: u32,
    pub started_at: u64,
    /// What chapay calls the new owner ("Vite").
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Owner {
    pid: u32,
    started_at: u64,
    /// Program plus project, so a restart of the same server is recognised.
    identity: String,
}

#[derive(Debug, Default)]
struct PortState {
    /// `false` until the first observation.
    seen: bool,
    last_owner: Option<Owner>,
}

/// The watched ports in `settings.json` (key `favourites`, ADR 0013): a list of
/// `{ "port": 5173, "name"?: "..." }`. Anything malformed is skipped; order and duplicates are
/// normalised away.
pub fn watched_ports_from_value(stored: Option<&serde_json::Value>) -> Vec<u16> {
    let Some(serde_json::Value::Array(items)) = stored else {
        return Vec::new();
    };
    let set: BTreeSet<u16> = items
        .iter()
        .filter_map(|item| item.get("port")?.as_u64())
        .filter_map(|p| u16::try_from(p).ok())
        .filter(|p| *p >= 1)
        .collect();
    set.into_iter().collect()
}

#[derive(Debug, Default)]
pub struct WatchedPortMonitor {
    ports: BTreeMap<u16, PortState>,
}

fn identity(e: &PortEntry) -> String {
    let program = e
        .executable_path
        .as_deref()
        .unwrap_or(e.process_name.as_str());
    format!("{program}|{}", e.project.as_deref().unwrap_or(""))
}

impl WatchedPortMonitor {
    /// Replaces the watched set. Ports that stay keep their history; a port added now is
    /// baselined by the next observation.
    pub fn set_watched(&mut self, ports: impl IntoIterator<Item = u16>) {
        let wanted: BTreeSet<u16> = ports.into_iter().collect();
        self.ports.retain(|p, _| wanted.contains(p));
        for p in wanted {
            self.ports.entry(p).or_default();
        }
    }

    #[cfg(test)]
    pub fn watched(&self) -> impl Iterator<Item = u16> + '_ {
        self.ports.keys().copied()
    }

    /// `entries` are the current listeners; rows for ports that are not watched are ignored.
    pub fn observe(&mut self, entries: &[PortEntry]) -> Vec<PortTaken> {
        let mut taken = Vec::new();
        for (port, state) in &mut self.ports {
            // Several listeners on one port (workers): the lowest pid stands for them.
            let holder = entries
                .iter()
                .filter(|e| e.port == *port)
                .min_by_key(|e| e.pid);
            match holder {
                None => {}
                Some(e) => {
                    let owner = Owner {
                        pid: e.pid,
                        started_at: e.started_at,
                        identity: identity(e),
                    };
                    let same_incarnation = state
                        .last_owner
                        .as_ref()
                        .is_some_and(|o| o.pid == owner.pid && o.started_at == owner.started_at);
                    if state.seen && !same_incarnation {
                        let known_program = state
                            .last_owner
                            .as_ref()
                            .is_some_and(|o| o.identity == owner.identity);
                        if !known_program {
                            taken.push(PortTaken {
                                port: *port,
                                pid: e.pid,
                                started_at: e.started_at,
                                label: e.label.clone(),
                            });
                        }
                    }
                    state.last_owner = Some(owner);
                }
            }
            state.seen = true;
        }
        taken
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ports::classify::PortCategory;

    fn entry(port: u16, pid: u32, started_at: u64, program: &str) -> PortEntry {
        PortEntry {
            port,
            pid,
            process_name: program.into(),
            command: program.into(),
            cwd: None,
            project: Some("web".into()),
            label: "Vite".into(),
            user: None,
            started_at,
            memory_bytes: 0,
            killable: true,
            category: PortCategory::Dev,
            executable_path: Some(format!("/bin/{program}")),
            app_bundle_path: None,
        }
    }

    fn monitor() -> WatchedPortMonitor {
        let mut m = WatchedPortMonitor::default();
        m.set_watched([5173]);
        m
    }

    #[test]
    fn the_first_observation_is_a_silent_baseline_even_if_the_port_is_busy() {
        let mut m = monitor();
        assert!(m.observe(&[entry(5173, 10, 1, "node")]).is_empty());
        let mut m = monitor();
        assert!(m.observe(&[]).is_empty());
    }

    #[test]
    fn free_then_listened_fires_once() {
        let mut m = monitor();
        m.observe(&[]);
        let hit = m.observe(&[entry(5173, 10, 1, "node")]);
        assert_eq!(
            hit,
            [PortTaken {
                port: 5173,
                pid: 10,
                started_at: 1,
                label: "Vite".into()
            }]
        );
        // The same incarnation on the next scans stays silent.
        assert!(m.observe(&[entry(5173, 10, 1, "node")]).is_empty());
        assert!(m.observe(&[entry(5173, 10, 1, "node")]).is_empty());
    }

    #[test]
    fn restarting_the_same_program_is_not_a_take() {
        let mut m = monitor();
        m.observe(&[entry(5173, 10, 1, "node")]);
        assert!(m.observe(&[]).is_empty());
        assert!(m.observe(&[entry(5173, 11, 50, "node")]).is_empty());
    }

    #[test]
    fn a_different_program_after_the_port_was_free_fires() {
        let mut m = monitor();
        m.observe(&[entry(5173, 10, 1, "node")]);
        m.observe(&[]);
        let hit = m.observe(&[entry(5173, 12, 60, "python3")]);
        assert_eq!(hit.len(), 1);
        assert_eq!(hit[0].pid, 12);
    }

    #[test]
    fn a_new_owner_between_two_scans_fires_even_without_seeing_the_gap() {
        let mut m = monitor();
        m.observe(&[entry(5173, 10, 1, "node")]);
        let hit = m.observe(&[entry(5173, 12, 60, "python3")]);
        assert_eq!(hit.len(), 1);
    }

    #[test]
    fn ports_that_are_not_watched_are_ignored_and_new_ones_baseline_first() {
        let mut m = monitor();
        m.observe(&[]);
        assert!(m.observe(&[entry(3000, 5, 1, "node")]).is_empty());
        m.set_watched([5173, 3000]);
        assert!(m.observe(&[entry(3000, 5, 1, "node")]).is_empty());
        assert_eq!(m.watched().collect::<Vec<_>>(), [3000, 5173]);
    }

    #[test]
    fn the_stored_list_is_read_leniently() {
        use serde_json::json;
        let v = json!([{"port": 5173, "name": "Vite"}, {"port": 3000}, {"port": 3000},
            {"port": 70000}, {"port": 0}, {"port": "x"}, "nope", {"name": "no port"}]);
        assert_eq!(watched_ports_from_value(Some(&v)), [3000, 5173]);
        assert!(watched_ports_from_value(None).is_empty());
        assert!(watched_ports_from_value(Some(&json!({"port": 1}))).is_empty());
    }

    #[test]
    fn unwatching_forgets_the_history() {
        let mut m = monitor();
        m.observe(&[entry(5173, 10, 1, "node")]);
        m.set_watched([]);
        m.set_watched([5173]);
        assert!(m.observe(&[entry(5173, 11, 9, "python3")]).is_empty());
    }
}
