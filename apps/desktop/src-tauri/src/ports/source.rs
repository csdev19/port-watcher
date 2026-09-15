use std::collections::HashSet;

use crate::error::AppError;

/// A listener as the OS reports it, before enrichment.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RawPort {
    pub pid: u32,
    pub port: u16,
    pub process_name: String,
}

/// Same PID+port on IPv4 and IPv6 is one row (spec §6). Output sorted by
/// port so the UI is stable between polls.
pub fn dedupe(items: impl IntoIterator<Item = RawPort>) -> Vec<RawPort> {
    let mut seen: HashSet<(u32, u16)> = HashSet::new();
    let mut out: Vec<RawPort> = items
        .into_iter()
        .filter(|item| seen.insert((item.pid, item.port)))
        .collect();
    out.sort_by_key(|r| (r.port, r.pid));
    out
}

/// All TCP listeners on this machine. We filter by protocol only, not by
/// socket state: `get_all` already returns listeners, and dropping rows on
/// an `UNKNOWN` state would silently hide real ports.
pub fn raw_ports() -> Result<Vec<RawPort>, AppError> {
    let all = listeners::get_all().map_err(|e| AppError::PortSource(e.to_string()))?;
    Ok(dedupe(
        all.into_iter()
            .filter(|l| l.protocol == listeners::Protocol::TCP)
            .map(|l| RawPort {
                pid: l.process.pid,
                port: l.socket.port(),
                process_name: l.process.name.clone(),
            }),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn raw(pid: u32, port: u16) -> RawPort {
        RawPort {
            pid,
            port,
            process_name: format!("p{pid}"),
        }
    }

    #[test]
    fn dedupe_collapses_same_pid_and_port() {
        // IPv4 + IPv6 duplicate of vite on 5173
        let out = dedupe([raw(10, 5173), raw(10, 5173), raw(20, 3000)]);
        assert_eq!(out, vec![raw(20, 3000), raw(10, 5173)]);
    }

    #[test]
    fn dedupe_keeps_same_port_from_different_pids() {
        // SO_REUSEPORT / forked workers: two pids on one port are two rows
        let out = dedupe([raw(10, 8080), raw(11, 8080)]);
        assert_eq!(out.len(), 2);
    }

    #[test]
    fn dedupe_sorts_by_port() {
        let out = dedupe([raw(1, 9000), raw(2, 80), raw(3, 5432)]);
        let ports: Vec<u16> = out.iter().map(|r| r.port).collect();
        assert_eq!(ports, vec![80, 5432, 9000]);
    }

    /// Live seam check (replaces the Task 1 smoke test).
    #[test]
    fn raw_ports_runs_on_this_machine() {
        let out = raw_ports().expect("raw_ports failed");
        // No duplicates by construction:
        let mut seen = std::collections::HashSet::new();
        assert!(out.iter().all(|r| seen.insert((r.pid, r.port))));
    }
}
