use std::path::PathBuf;
use std::time::Duration;

use nix::errno::Errno;
use nix::sys::signal::{self, Signal};
use nix::unistd::Pid as NixPid;
use sysinfo::{Pid, ProcessRefreshKind, ProcessStatus, ProcessesToUpdate, System, UpdateKind};

use crate::error::AppError;

use super::classify::{classify_port, PortCategory};
use super::models::KillResult;
use super::source::raw_ports;

/// How often the escalation re-checks the target.
const POLL_INTERVAL: Duration = Duration::from_millis(100);
/// Polls after SIGTERM before escalating to SIGKILL (20 x 100 ms = 2 s, spec §7).
const TERM_POLLS: u32 = 20;
/// Polls after SIGKILL before reporting that the process survived (1 s).
const KILL_POLLS: u32 = 10;

/// What the kill path needs to know about a live process.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProcessSnapshot {
    /// Epoch seconds; together with the PID it identifies one incarnation.
    pub start_time: u64,
    pub owner_uid: Option<u32>,
    pub executable: Option<PathBuf>,
    /// Exited but not yet reaped by its parent: already dead.
    pub zombie: bool,
}

/// The OS calls the kill path makes, behind a trait so every guard and
/// escalation branch is unit-testable without real processes.
pub trait ProcessOps {
    /// Is `pid` currently listening on `port`?
    fn is_listening(&self, pid: u32, port: u16) -> Result<bool, AppError>;
    /// A fresh look at `pid`, or `None` when no such process exists.
    fn snapshot(&self, pid: u32) -> Option<ProcessSnapshot>;
    fn send_signal(&self, pid: i32, signal: Signal) -> Result<(), Errno>;
    fn sleep(&self, duration: Duration);
    fn current_uid(&self) -> u32;
    fn self_pid(&self) -> u32;
}

/// The real OS: listeners for the port table, sysinfo for process state,
/// nix for signals.
pub struct SystemOps;

impl ProcessOps for SystemOps {
    fn is_listening(&self, pid: u32, port: u16) -> Result<bool, AppError> {
        Ok(raw_ports()?.iter().any(|r| r.pid == pid && r.port == port))
    }

    fn snapshot(&self, pid: u32) -> Option<ProcessSnapshot> {
        let target = Pid::from_u32(pid);
        let mut sys = System::new();
        sys.refresh_processes_specifics(
            ProcessesToUpdate::Some(&[target]),
            true,
            ProcessRefreshKind::nothing()
                .with_user(UpdateKind::Always)
                .with_exe(UpdateKind::Always),
        );
        let proc = sys.process(target)?;
        Some(ProcessSnapshot {
            start_time: proc.start_time(),
            owner_uid: proc.user_id().map(|u| **u),
            executable: proc
                .exe()
                .filter(|p| !p.as_os_str().is_empty())
                .map(PathBuf::from),
            zombie: proc.status() == ProcessStatus::Zombie,
        })
    }

    fn send_signal(&self, pid: i32, signal: Signal) -> Result<(), Errno> {
        signal::kill(NixPid::from_raw(pid), signal)
    }

    fn sleep(&self, duration: Duration) {
        std::thread::sleep(duration);
    }

    fn current_uid(&self) -> u32 {
        nix::unistd::Uid::effective().as_raw()
    }

    fn self_pid(&self) -> u32 {
        std::process::id()
    }
}

/// The static half of the spec's safety rules, pure so it's unit-testable:
/// never signal a PID below 100, our own process, or a PID that does not fit
/// the `pid_t` the kernel takes (it could only be a bogus request).
pub fn static_guard(pid: u32, self_pid: u32) -> Option<KillResult> {
    if pid < 100 || pid == self_pid || i32::try_from(pid).is_err() {
        return Some(KillResult::PermissionDenied);
    }
    None
}

/// The static policy as the list shows it: the UI offers a kill only when
/// `kill_port` would not refuse it up front (same user, not System, and
/// past the static guard).
pub fn is_killable(same_user: bool, category: PortCategory, pid: u32, self_pid: u32) -> bool {
    same_user && category != PortCategory::System && static_guard(pid, self_pid).is_none()
}

/// Full guard chain, then escalation. Blocking (sleeps up to ~3 s) — the
/// command wraps it in spawn_blocking.
pub fn kill_port_impl(pid: u32, port: u16, started_at: u64) -> Result<KillResult, AppError> {
    kill_port_with(&SystemOps, pid, port, started_at)
}

/// `kill_port_impl` against injectable OS calls.
pub fn kill_port_with(
    ops: &impl ProcessOps,
    pid: u32,
    port: u16,
    started_at: u64,
) -> Result<KillResult, AppError> {
    log::info!("kill_port requested: pid={pid} port={port} started_at={started_at}");
    if let Some(denied) = static_guard(pid, ops.self_pid()) {
        log::warn!("kill_port denied by static guard: pid={pid} port={port}");
        return Ok(denied);
    }
    let Ok(raw_pid) = i32::try_from(pid) else {
        // Unreachable: static_guard already refused it. Kept so the cast
        // below can never wrap.
        return Ok(KillResult::PermissionDenied);
    };

    // PID-reuse guard 1: that PID must still be listening on that port.
    if !ops.is_listening(pid, port)? {
        log::warn!("kill_port: pid={pid} no longer listening on port={port}");
        return Ok(KillResult::AlreadyGone);
    }

    // PID-reuse guard 2: same start time = same process incarnation. A
    // zombie has already exited; signalling it does nothing.
    let Some(proc) = ops.snapshot(pid) else {
        log::warn!("kill_port: pid={pid} vanished before it could be signalled");
        return Ok(KillResult::AlreadyGone);
    };
    if proc.zombie {
        log::warn!("kill_port: pid={pid} is a zombie (already exited)");
        return Ok(KillResult::AlreadyGone);
    }
    if proc.start_time != started_at {
        log::warn!("kill_port: pid={pid} start_time mismatch (likely pid reuse)");
        return Ok(KillResult::AlreadyGone);
    }

    // Ownership: v1 never signals another user's process (no sudo).
    let my_uid = ops.current_uid();
    if proc.owner_uid != Some(my_uid) {
        log::warn!("kill_port: pid={pid} owned by a different user");
        return Ok(KillResult::PermissionDenied);
    }

    // Policy: never kill a System listener, whatever the renderer asked.
    // The category is re-derived from the live process, not trusted from
    // the request, so a compromised renderer cannot bypass it.
    if classify_port(proc.owner_uid, my_uid, proc.executable.as_deref()) == PortCategory::System {
        log::warn!("kill_port: pid={pid} is a system process; refusing");
        return Ok(KillResult::PermissionDenied);
    }

    log::info!("kill_port guards passed for pid={pid}; escalating");
    escalate(ops, pid, raw_pid, started_at)
}

/// Is the incarnation we validated gone? A missing PID, a zombie, or a PID
/// now held by a different process (another start time) all mean yes.
fn is_gone(ops: &impl ProcessOps, pid: u32, started_at: u64) -> bool {
    match ops.snapshot(pid) {
        None => true,
        Some(s) => s.zombie || s.start_time != started_at,
    }
}

/// Poll up to `polls` times; true as soon as the incarnation is gone.
fn wait_until_gone(ops: &impl ProcessOps, pid: u32, started_at: u64, polls: u32) -> bool {
    for _ in 0..polls {
        ops.sleep(POLL_INTERVAL);
        if is_gone(ops, pid, started_at) {
            return true;
        }
    }
    false
}

fn signal_failure(pid: u32, signal: Signal, errno: Errno) -> AppError {
    AppError::Kill(format!("{signal} to pid {pid} failed: {}", errno.desc()))
}

/// SIGTERM, poll every 100 ms up to 2 s, re-validate, then SIGKILL and
/// confirm the process actually died (spec §7).
fn escalate(
    ops: &impl ProcessOps,
    pid: u32,
    raw_pid: i32,
    started_at: u64,
) -> Result<KillResult, AppError> {
    match ops.send_signal(raw_pid, Signal::SIGTERM) {
        Ok(()) => {}
        Err(Errno::ESRCH) => return Ok(KillResult::AlreadyGone),
        Err(Errno::EPERM) => return Ok(KillResult::PermissionDenied),
        Err(errno) => return Err(signal_failure(pid, Signal::SIGTERM, errno)),
    }

    // The last poll is also the re-validation before SIGKILL: if the PID
    // was reused inside the window, the start time differs and the new
    // process is never signalled. (A reuse between this check and the
    // syscall below cannot be ruled out without pidfds, which macOS lacks.)
    if wait_until_gone(ops, pid, started_at, TERM_POLLS) {
        return Ok(KillResult::Terminated);
    }

    log::warn!("kill_port: pid={pid} survived SIGTERM; sending SIGKILL");
    match ops.send_signal(raw_pid, Signal::SIGKILL) {
        Ok(()) => {}
        Err(Errno::ESRCH) => return Ok(KillResult::Terminated),
        Err(Errno::EPERM) => return Ok(KillResult::PermissionDenied),
        Err(errno) => return Err(signal_failure(pid, Signal::SIGKILL, errno)),
    }

    if wait_until_gone(ops, pid, started_at, KILL_POLLS) {
        return Ok(KillResult::Killed);
    }
    log::error!("kill_port: pid={pid} survived SIGKILL");
    Err(AppError::Kill(format!(
        "pid {pid} is still running after SIGKILL"
    )))
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;
    use std::collections::VecDeque;

    use super::*;

    const MY_UID: u32 = 501;
    const SELF_PID: u32 = 9000;
    const PID: u32 = 4242;
    const STARTED: u64 = 1_757_000_000;

    fn dev_process() -> ProcessSnapshot {
        ProcessSnapshot {
            start_time: STARTED,
            owner_uid: Some(MY_UID),
            executable: Some(PathBuf::from("/opt/homebrew/bin/node")),
            zombie: false,
        }
    }

    /// Scripted OS. `snapshots` is consumed one per call; once it runs out
    /// the last answer repeats. `signal_results` likewise, defaulting to Ok.
    struct FakeOps {
        listening: Result<bool, String>,
        snapshots: RefCell<VecDeque<Option<ProcessSnapshot>>>,
        last_snapshot: RefCell<Option<ProcessSnapshot>>,
        signal_results: RefCell<VecDeque<Result<(), Errno>>>,
        sent: RefCell<Vec<(i32, Signal)>>,
    }

    impl FakeOps {
        fn new(snapshots: Vec<Option<ProcessSnapshot>>) -> Self {
            Self {
                listening: Ok(true),
                snapshots: RefCell::new(snapshots.into()),
                last_snapshot: RefCell::new(None),
                signal_results: RefCell::new(VecDeque::new()),
                sent: RefCell::new(Vec::new()),
            }
        }

        fn with_signal_results(self, results: Vec<Result<(), Errno>>) -> Self {
            *self.signal_results.borrow_mut() = results.into();
            self
        }

        fn signals(&self) -> Vec<Signal> {
            self.sent.borrow().iter().map(|(_, s)| *s).collect()
        }
    }

    impl ProcessOps for FakeOps {
        fn is_listening(&self, _pid: u32, _port: u16) -> Result<bool, AppError> {
            self.listening.clone().map_err(AppError::PortSource)
        }

        fn snapshot(&self, _pid: u32) -> Option<ProcessSnapshot> {
            if let Some(next) = self.snapshots.borrow_mut().pop_front() {
                *self.last_snapshot.borrow_mut() = next;
            }
            self.last_snapshot.borrow().clone()
        }

        fn send_signal(&self, pid: i32, signal: Signal) -> Result<(), Errno> {
            self.sent.borrow_mut().push((pid, signal));
            self.signal_results
                .borrow_mut()
                .pop_front()
                .unwrap_or(Ok(()))
        }

        fn sleep(&self, _duration: Duration) {}

        fn current_uid(&self) -> u32 {
            MY_UID
        }

        fn self_pid(&self) -> u32 {
            SELF_PID
        }
    }

    fn run(ops: &FakeOps) -> Result<KillResult, AppError> {
        kill_port_with(ops, PID, 3000, STARTED)
    }

    #[test]
    fn static_guard_blocks_low_pids_and_self() {
        assert_eq!(static_guard(1, 5000), Some(KillResult::PermissionDenied));
        assert_eq!(static_guard(99, 5000), Some(KillResult::PermissionDenied));
        assert_eq!(static_guard(5000, 5000), Some(KillResult::PermissionDenied));
        assert_eq!(static_guard(100, 5000), None);
        assert_eq!(static_guard(4242, 5000), None);
    }

    #[test]
    fn static_guard_blocks_pids_that_do_not_fit_pid_t() {
        assert_eq!(static_guard(i32::MAX as u32, 5000), None);
        assert_eq!(
            static_guard(i32::MAX as u32 + 1, 5000),
            Some(KillResult::PermissionDenied)
        );
        assert_eq!(
            static_guard(u32::MAX, 5000),
            Some(KillResult::PermissionDenied)
        );
    }

    #[test]
    fn is_killable_mirrors_the_backend_policy() {
        assert!(is_killable(true, PortCategory::Dev, PID, SELF_PID));
        assert!(is_killable(true, PortCategory::App, PID, SELF_PID));
        assert!(!is_killable(true, PortCategory::System, PID, SELF_PID));
        assert!(!is_killable(false, PortCategory::Dev, PID, SELF_PID));
        assert!(!is_killable(true, PortCategory::Dev, SELF_PID, SELF_PID));
        assert!(!is_killable(true, PortCategory::Dev, 50, SELF_PID));
    }

    #[test]
    fn static_guard_runs_before_any_os_call() {
        for pid in [SELF_PID, 50, u32::MAX] {
            let ops = FakeOps::new(vec![Some(dev_process())]);
            assert_eq!(
                kill_port_with(&ops, pid, 3000, STARTED).unwrap(),
                KillResult::PermissionDenied,
                "pid {pid}"
            );
            assert!(ops.signals().is_empty());
            assert!(
                ops.last_snapshot.borrow().is_none(),
                "snapshot taken for pid {pid}"
            );
        }
    }

    #[test]
    fn not_listening_is_already_gone_and_never_signals() {
        let mut ops = FakeOps::new(vec![Some(dev_process())]);
        ops.listening = Ok(false);
        assert_eq!(run(&ops).unwrap(), KillResult::AlreadyGone);
        assert!(ops.signals().is_empty());
    }

    #[test]
    fn port_table_error_propagates() {
        let mut ops = FakeOps::new(vec![Some(dev_process())]);
        ops.listening = Err("boom".into());
        assert!(matches!(run(&ops), Err(AppError::PortSource(_))));
        assert!(ops.signals().is_empty());
    }

    #[test]
    fn vanished_process_is_already_gone() {
        let ops = FakeOps::new(vec![None]);
        assert_eq!(run(&ops).unwrap(), KillResult::AlreadyGone);
        assert!(ops.signals().is_empty());
    }

    #[test]
    fn zombie_is_already_gone_and_never_signals() {
        let ops = FakeOps::new(vec![Some(ProcessSnapshot {
            zombie: true,
            ..dev_process()
        })]);
        assert_eq!(run(&ops).unwrap(), KillResult::AlreadyGone);
        assert!(ops.signals().is_empty());
    }

    #[test]
    fn start_time_mismatch_is_already_gone() {
        let ops = FakeOps::new(vec![Some(ProcessSnapshot {
            start_time: STARTED + 5,
            ..dev_process()
        })]);
        assert_eq!(run(&ops).unwrap(), KillResult::AlreadyGone);
        assert!(ops.signals().is_empty());
    }

    #[test]
    fn other_users_process_is_denied() {
        let ops = FakeOps::new(vec![Some(ProcessSnapshot {
            owner_uid: Some(0),
            ..dev_process()
        })]);
        assert_eq!(run(&ops).unwrap(), KillResult::PermissionDenied);
        assert!(ops.signals().is_empty());
    }

    #[test]
    fn unknown_owner_is_denied() {
        let ops = FakeOps::new(vec![Some(ProcessSnapshot {
            owner_uid: None,
            ..dev_process()
        })]);
        assert_eq!(run(&ops).unwrap(), KillResult::PermissionDenied);
        assert!(ops.signals().is_empty());
    }

    #[test]
    fn same_user_system_executable_is_denied() {
        let ops = FakeOps::new(vec![Some(ProcessSnapshot {
            executable: Some(PathBuf::from(
                "/System/Library/CoreServices/ControlCenter.app/Contents/MacOS/ControlCenter",
            )),
            ..dev_process()
        })]);
        assert_eq!(run(&ops).unwrap(), KillResult::PermissionDenied);
        assert!(ops.signals().is_empty());
    }

    #[test]
    fn same_user_app_bundle_is_allowed() {
        let ops = FakeOps::new(vec![
            Some(ProcessSnapshot {
                executable: Some(PathBuf::from(
                    "/Applications/Discord.app/Contents/MacOS/Discord",
                )),
                ..dev_process()
            }),
            None,
        ]);
        assert_eq!(run(&ops).unwrap(), KillResult::Terminated);
        assert_eq!(ops.signals(), vec![Signal::SIGTERM]);
    }

    #[test]
    fn dies_on_sigterm_is_terminated() {
        let ops = FakeOps::new(vec![Some(dev_process()), None]);
        assert_eq!(run(&ops).unwrap(), KillResult::Terminated);
        assert_eq!(
            ops.sent.borrow().as_slice(),
            &[(PID as i32, Signal::SIGTERM)]
        );
    }

    #[test]
    fn zombie_after_sigterm_counts_as_terminated() {
        let ops = FakeOps::new(vec![
            Some(dev_process()),
            Some(dev_process()),
            Some(ProcessSnapshot {
                zombie: true,
                ..dev_process()
            }),
        ]);
        assert_eq!(run(&ops).unwrap(), KillResult::Terminated);
        assert_eq!(ops.signals(), vec![Signal::SIGTERM]);
    }

    #[test]
    fn pid_reused_during_the_window_is_never_sigkilled() {
        let ops = FakeOps::new(vec![
            Some(dev_process()),
            Some(dev_process()),
            Some(ProcessSnapshot {
                start_time: STARTED + 1,
                ..dev_process()
            }),
        ]);
        assert_eq!(run(&ops).unwrap(), KillResult::Terminated);
        assert_eq!(ops.signals(), vec![Signal::SIGTERM]);
    }

    #[test]
    fn sigterm_esrch_is_already_gone() {
        let ops =
            FakeOps::new(vec![Some(dev_process())]).with_signal_results(vec![Err(Errno::ESRCH)]);
        assert_eq!(run(&ops).unwrap(), KillResult::AlreadyGone);
    }

    #[test]
    fn sigterm_eperm_is_permission_denied() {
        let ops =
            FakeOps::new(vec![Some(dev_process())]).with_signal_results(vec![Err(Errno::EPERM)]);
        assert_eq!(run(&ops).unwrap(), KillResult::PermissionDenied);
    }

    #[test]
    fn sigterm_other_errno_is_an_error_not_permission_denied() {
        let ops =
            FakeOps::new(vec![Some(dev_process())]).with_signal_results(vec![Err(Errno::EINVAL)]);
        let err = run(&ops).unwrap_err();
        assert!(matches!(err, AppError::Kill(_)), "got {err:?}");
        assert_eq!(ops.signals(), vec![Signal::SIGTERM]);
    }

    /// The fake keeps answering "alive" until the snapshot script switches
    /// to `None`: TERM_POLLS alive answers after the guard snapshot means
    /// SIGTERM was ignored for the whole window.
    fn ignores_sigterm_then(after_kill: Vec<Option<ProcessSnapshot>>) -> FakeOps {
        let mut script = vec![Some(dev_process()); 1 + TERM_POLLS as usize];
        script.extend(after_kill);
        FakeOps::new(script)
    }

    #[test]
    fn survives_sigterm_then_dies_on_sigkill_is_killed() {
        let ops = ignores_sigterm_then(vec![None]);
        assert_eq!(run(&ops).unwrap(), KillResult::Killed);
        assert_eq!(ops.signals(), vec![Signal::SIGTERM, Signal::SIGKILL]);
    }

    #[test]
    fn survives_sigkill_is_reported_as_failure() {
        let ops = ignores_sigterm_then(vec![]);
        let err = run(&ops).unwrap_err();
        assert!(matches!(err, AppError::Kill(_)), "got {err:?}");
        assert_eq!(ops.signals(), vec![Signal::SIGTERM, Signal::SIGKILL]);
    }

    #[test]
    fn sigkill_esrch_means_it_died_just_before() {
        let ops = ignores_sigterm_then(vec![]).with_signal_results(vec![Ok(()), Err(Errno::ESRCH)]);
        assert_eq!(run(&ops).unwrap(), KillResult::Terminated);
    }

    #[test]
    fn sigkill_eperm_is_permission_denied() {
        let ops = ignores_sigterm_then(vec![]).with_signal_results(vec![Ok(()), Err(Errno::EPERM)]);
        assert_eq!(run(&ops).unwrap(), KillResult::PermissionDenied);
    }

    #[test]
    fn sigkill_other_errno_is_an_error() {
        let ops =
            ignores_sigterm_then(vec![]).with_signal_results(vec![Ok(()), Err(Errno::EINVAL)]);
        assert!(matches!(run(&ops), Err(AppError::Kill(_))));
    }

    #[test]
    fn targeted_snapshot_resolves_a_live_process() {
        let me = std::process::id();
        let snap = SystemOps
            .snapshot(me)
            .expect("targeted refresh lost our own pid");
        assert!(snap.start_time > 0);
        assert!(!snap.zombie);
        assert_eq!(snap.owner_uid, Some(nix::unistd::Uid::effective().as_raw()));
        assert!(snap.executable.is_some());
    }

    #[test]
    fn pid_not_listening_on_port_is_already_gone() {
        // Port 1 with a huge pid: nothing real matches → AlreadyGone,
        // and crucially nothing gets signalled.
        let out = kill_port_impl(999_999, 1, 42).unwrap();
        assert_eq!(out, KillResult::AlreadyGone);
    }

    /// Full escalation against a real child we own. The child is reaped on
    /// a background thread so it does not linger as a zombie, matching how
    /// a supervised child behaves (a lingering zombie also counts as gone
    /// now, but reaping keeps the test independent of that).
    #[test]
    fn escalate_terminates_a_real_child() {
        let mut child = std::process::Command::new("sleep")
            .arg("30")
            .spawn()
            .unwrap();
        let pid = child.id();
        std::thread::spawn(move || {
            let _ = child.wait();
        });
        let started_at = SystemOps.snapshot(pid).expect("child not found").start_time;
        let raw = i32::try_from(pid).unwrap();
        let result = escalate(&SystemOps, pid, raw, started_at).unwrap();
        assert_eq!(result, KillResult::Terminated);
        assert!(is_gone(&SystemOps, pid, started_at));
    }
}
