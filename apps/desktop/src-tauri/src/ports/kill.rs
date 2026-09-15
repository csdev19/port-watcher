use std::time::Duration;

use nix::errno::Errno;
use nix::sys::signal::{self, Signal};
use nix::unistd::Pid as NixPid;
use sysinfo::{Pid, ProcessesToUpdate, System};

use crate::error::AppError;

use super::models::KillResult;
use super::source::raw_ports;

/// The static half of the spec's safety rules, pure so it's unit-testable:
/// never signal a PID below 100 or our own process.
pub fn static_guard(pid: u32, self_pid: u32) -> Option<KillResult> {
    if pid < 100 || pid == self_pid {
        return Some(KillResult::PermissionDenied);
    }
    None
}

/// Full guard chain, then escalation. Blocking (sleeps up to ~2 s) — the
/// command wraps it in spawn_blocking.
pub fn kill_port_impl(pid: u32, port: u16, started_at: u64) -> Result<KillResult, AppError> {
    log::info!("kill_port requested: pid={pid} port={port} started_at={started_at}");
    if let Some(denied) = static_guard(pid, std::process::id()) {
        return Ok(denied);
    }

    // PID-reuse guard 1: that PID must still be listening on that port.
    let still_listening = raw_ports()?.iter().any(|r| r.pid == pid && r.port == port);
    if !still_listening {
        return Ok(KillResult::AlreadyGone);
    }

    // PID-reuse guard 2: same start time = same process incarnation.
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::Some(&[Pid::from_u32(pid)]), true);
    let Some(proc) = sys.process(Pid::from_u32(pid)) else {
        return Ok(KillResult::AlreadyGone);
    };
    if proc.start_time() != started_at {
        return Ok(KillResult::AlreadyGone);
    }

    // Ownership: v1 never signals another user's process (no sudo).
    let my_uid = nix::unistd::Uid::effective().as_raw();
    if proc.user_id().map(|u| **u) != Some(my_uid) {
        return Ok(KillResult::PermissionDenied);
    }

    log::info!("kill_port guards passed for pid={pid}; escalating");
    Ok(escalate(pid))
}

/// SIGTERM, poll every 100 ms up to 2 s, then SIGKILL (spec §7).
fn escalate(pid: u32) -> KillResult {
    let target = NixPid::from_raw(pid as i32);
    match signal::kill(target, Signal::SIGTERM) {
        Err(Errno::ESRCH) => return KillResult::AlreadyGone,
        Err(_) => return KillResult::PermissionDenied,
        Ok(()) => {}
    }
    for _ in 0..20 {
        std::thread::sleep(Duration::from_millis(100));
        if !alive(target) {
            return KillResult::Terminated;
        }
    }
    let _ = signal::kill(target, Signal::SIGKILL);
    KillResult::Killed
}

/// Signal 0 probes existence. EPERM means "exists, not ours" = alive.
fn alive(pid: NixPid) -> bool {
    match signal::kill(pid, None) {
        Ok(()) => true,
        Err(Errno::EPERM) => true,
        Err(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn static_guard_blocks_low_pids_and_self() {
        assert_eq!(static_guard(1, 5000), Some(KillResult::PermissionDenied));
        assert_eq!(static_guard(99, 5000), Some(KillResult::PermissionDenied));
        assert_eq!(static_guard(5000, 5000), Some(KillResult::PermissionDenied));
        assert_eq!(static_guard(100, 5000), None);
        assert_eq!(static_guard(4242, 5000), None);
    }

    #[test]
    fn pid_not_listening_on_port_is_already_gone() {
        // Port 1 with a huge pid: nothing real matches → AlreadyGone,
        // and crucially nothing gets signalled.
        let out = kill_port_impl(999_999, 1, 42).unwrap();
        assert_eq!(out, KillResult::AlreadyGone);
    }

    /// Full escalation path against a real child we own: spawn a sleep
    /// that ignores nothing, bind it? No — simplest honest test: spawn a
    /// child, then run escalate() directly and assert it dies via SIGTERM.
    ///
    /// A child we never `wait()` on becomes a zombie the instant it exits,
    /// and on macOS/Linux `kill(pid, 0)` still succeeds against a zombie
    /// (the PID table entry lingers until reaped) — so `alive()` would keep
    /// reporting true and `escalate` would wrongly fall through to
    /// SIGKILL. Reap it on a background thread as soon as it dies so the
    /// kernel frees the PID immediately, matching how a real supervised
    /// child behaves.
    #[test]
    fn escalate_terminates_a_real_child() {
        let mut child = std::process::Command::new("sleep").arg("30").spawn().unwrap();
        let pid = child.id();
        std::thread::spawn(move || {
            let _ = child.wait();
        });
        let result = escalate(pid);
        assert_eq!(result, KillResult::Terminated);
        assert!(!alive(NixPid::from_raw(pid as i32)));
    }
}
