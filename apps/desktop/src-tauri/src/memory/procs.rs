//! Per-process physical footprint from libproc. `phys_footprint` is what
//! Activity Monitor and `top -stats mem` show; RSS leaves out compressed
//! pages and reported the 16 GB daemon of the 2026-11-06 evidence as 1 GB
//! (ADR 0011). Ported from feat/chapay-v2 crates/system-health
//! (`infra/procs.rs`, `infra/ffi.rs`).
//!
//! Reach: `proc_pid_rusage` is refused (EPERM) for other users' processes,
//! root daemons included, so `top` supplies those footprints (`topcmd.rs`).
//! `top` is rationed to once per bucket; rusage wins whenever it can read a
//! PID, because it is fresh every tick.
//!
//! Cost control: the footprint read is one cheap syscall per PID, so it runs
//! for all of them; the name, path, owner and start time (three more
//! syscalls) are read only for the few processes that are kept.

use std::collections::{HashMap, HashSet};
use std::ffi::c_void;

const RUSAGE_INFO_V4: i32 = 4;
const RUSAGE_INFO_V6: i32 = 6;
const PROC_PIDPATHINFO_MAXSIZE: usize = 4096;

use super::topcmd::TopRow;

const KINFO_PROC_SIZE: usize = 648;
const OFF_START_SEC: usize = 0;
const OFF_PID: usize = 40;
const OFF_UID: usize = 420;

/// How many processes a tick keeps, shows and samples.
pub const TOP_N: usize = 8;

extern "C" {
    fn proc_listallpids(buffer: *mut c_void, buffersize: i32) -> i32;
    fn proc_pidpath(pid: i32, buffer: *mut c_void, buffersize: u32) -> i32;
    fn proc_name(pid: i32, buffer: *mut c_void, buffersize: u32) -> i32;
    fn proc_pid_rusage(pid: i32, flavor: i32, buffer: *mut c_void) -> i32;
}

/// `rusage_info_v6` (sys/resource.h). Older flavors are a prefix of this
/// layout and the kernel writes only as much as the requested flavor holds,
/// so the tail stays zero for V4.
#[repr(C)]
#[derive(Default)]
struct RusageInfo {
    uuid: [u8; 16],
    user_time: u64,
    system_time: u64,
    pkg_idle_wkups: u64,
    interrupt_wkups: u64,
    pageins: u64,
    wired_size: u64,
    resident_size: u64,
    phys_footprint: u64,
    proc_start_abstime: u64,
    proc_exit_abstime: u64,
    _v4_tail: [u64; 25],
    flags: u64,
    user_ptime: u64,
    system_ptime: u64,
    pinstructions: u64,
    pcycles: u64,
    energy_nj: u64,
    _v6_tail: [u64; 15],
}

// Layout checked against `sizeof`/`offsetof` of `struct rusage_info_v6`.
const _: () = {
    assert!(std::mem::size_of::<RusageInfo>() == 464);
    assert!(std::mem::offset_of!(RusageInfo, phys_footprint) == 72);
};

/// One process incarnation and what it holds. `started_at` (epoch seconds,
/// the BSD start time sysinfo also reports) together with `pid` names one
/// incarnation everywhere, including the kill guard.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProcInfo {
    pub pid: u32,
    pub started_at: u64,
    pub name: String,
    pub path: Option<String>,
    pub uid: Option<u32>,
    pub footprint_bytes: u64,
}

/// Reads footprints; remembers which rusage flavor the OS accepts.
pub struct ProcessReader {
    /// V6 is tried first; V4 is the fallback for older systems.
    flavor: i32,
}

impl Default for ProcessReader {
    fn default() -> Self {
        Self::new()
    }
}

impl ProcessReader {
    pub fn new() -> Self {
        Self {
            flavor: RUSAGE_INFO_V6,
        }
    }

    /// `phys_footprint` of `pid`, or `None` when it exited or may not be read.
    fn footprint(&mut self, pid: i32) -> Option<u64> {
        let mut info = RusageInfo::default();
        // SAFETY: `info` is repr(C) and at least as large as the flavor.
        let rc = unsafe { proc_pid_rusage(pid, self.flavor, &mut info as *mut _ as *mut c_void) };
        if rc == 0 {
            return Some(info.phys_footprint);
        }
        if self.flavor == RUSAGE_INFO_V6 {
            let mut info = RusageInfo::default();
            // SAFETY: as above.
            let rc =
                unsafe { proc_pid_rusage(pid, RUSAGE_INFO_V4, &mut info as *mut _ as *mut c_void) };
            if rc == 0 {
                // Downgrade for good only when V4 works for a process V6
                // rejects: a V6 failure alone may just be a process that left.
                self.flavor = RUSAGE_INFO_V4;
                return Some(info.phys_footprint);
            }
        }
        None
    }

    /// The `n` biggest processes by footprint, biggest first. `extra` is the
    /// cached `top` snapshot: a PID that rusage could not read takes top's
    /// footprint; when both have it, rusage's is kept. A PID whose start time
    /// cannot be read (it exited) is skipped; the tick carries on.
    ///
    /// The owner and start time come from `proc_pidinfo`, readable for any
    /// PID. The path may be refused for a root process: then it is `None`
    /// and the command card falls back to `sudo kill <pid>`.
    pub fn top(&mut self, n: usize, extra: &[TopRow]) -> Vec<ProcInfo> {
        let mut sized: Vec<(i32, u64)> = list_pids()
            .into_iter()
            .filter_map(|pid| self.footprint(pid).map(|f| (pid, f)))
            .collect();
        let mut top_names: HashMap<i32, &str> = HashMap::new();
        let readable: HashSet<i32> = sized.iter().map(|(pid, _)| *pid).collect();
        for row in extra {
            let Ok(pid) = i32::try_from(row.pid) else {
                continue;
            };
            top_names.insert(pid, row.name.as_str());
            if !readable.contains(&pid) {
                sized.push((pid, row.footprint_bytes));
            }
        }
        sized.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
        sized
            .into_iter()
            .filter_map(|(pid, footprint)| {
                let (uid, started_at) = bsd_identity(pid);
                // Without a start time there is no incarnation key.
                let started_at = started_at?;
                Some(ProcInfo {
                    pid: pid as u32,
                    started_at,
                    // top truncates names to 16 characters: only a fallback.
                    name: name_of(pid)
                        .or_else(|| top_names.get(&pid).map(|n| (*n).to_owned()))
                        .unwrap_or_else(|| format!("pid {pid}")),
                    path: path_of(pid),
                    uid,
                    footprint_bytes: footprint,
                })
            })
            .take(n)
            .collect()
    }
}

fn list_pids() -> Vec<i32> {
    // SAFETY: a null buffer asks only for the size.
    let size = unsafe { proc_listallpids(std::ptr::null_mut(), 0) };
    if size <= 0 {
        return Vec::new();
    }
    // The sizing call returns a count on current macOS but the docs say
    // bytes; reading it as a number of i32 slots is enough for both (4x too
    // many slots in the bytes case), plus headroom for processes that start
    // between the two calls. Sizing it as bytes/4 truncated the list to a
    // third of the processes on this machine.
    let mut pids = vec![0i32; size as usize * 2 + 256];
    // SAFETY: the buffer holds `pids.len()` i32 values.
    let got = unsafe {
        proc_listallpids(
            pids.as_mut_ptr() as *mut c_void,
            (pids.len() * std::mem::size_of::<i32>()) as i32,
        )
    };
    if got <= 0 {
        return Vec::new();
    }
    pids.retain(|p| *p > 0);
    pids
}

fn name_of(pid: i32) -> Option<String> {
    let mut buf = [0u8; 256];
    // SAFETY: the buffer is `buf.len()` bytes.
    let n = unsafe { proc_name(pid, buf.as_mut_ptr() as *mut c_void, buf.len() as u32) };
    if n <= 0 {
        return None;
    }
    Some(String::from_utf8_lossy(&buf[..n as usize]).into_owned())
}

fn path_of(pid: i32) -> Option<String> {
    let mut buf = vec![0u8; PROC_PIDPATHINFO_MAXSIZE];
    // SAFETY: the buffer is `buf.len()` bytes.
    let n = unsafe { proc_pidpath(pid, buf.as_mut_ptr() as *mut c_void, buf.len() as u32) };
    if n <= 0 {
        return None;
    }
    Some(String::from_utf8_lossy(&buf[..n as usize]).into_owned())
}

/// Owner uid and BSD start time (epoch seconds) from `kern.proc.pid`. Unlike
/// `proc_pidinfo(PROC_PIDTBSDINFO)`, which the kernel refuses for other users'
/// processes, this is readable for any PID: it is what lets a root daemon
/// have a start time (the PID-reuse guard) and an owner.
fn bsd_identity(pid: i32) -> (Option<u32>, Option<u64>) {
    let mut mib = [libc::CTL_KERN, libc::KERN_PROC, libc::KERN_PROC_PID, pid];
    // `struct kinfo_proc` is not in the libc crate. It is 648 bytes on both
    // macOS architectures, and the three fields used sit at fixed offsets
    // (sys/sysctl.h: `kp_proc.p_starttime`, `kp_proc.p_pid`,
    // `kp_eproc.e_ucred.cr_uid`); the tests check them against sysinfo.
    let mut buf = [0u8; KINFO_PROC_SIZE];
    let mut len = buf.len();
    // SAFETY: the kernel writes at most `len` bytes into `buf` and reports
    // how many it wrote.
    let rc = unsafe {
        libc::sysctl(
            mib.as_mut_ptr(),
            mib.len() as u32,
            buf.as_mut_ptr() as *mut c_void,
            &mut len,
            std::ptr::null_mut(),
            0,
        )
    };
    // A PID that does not exist answers with rc 0 and zero bytes.
    if rc != 0 || len != KINFO_PROC_SIZE {
        return (None, None);
    }
    let word = |at: usize, n: usize| -> u64 {
        let mut b = [0u8; 8];
        b[..n].copy_from_slice(&buf[at..at + n]);
        u64::from_le_bytes(b)
    };
    if word(OFF_PID, 4) as i32 != pid {
        return (None, None);
    }
    let start = word(OFF_START_SEC, 8);
    (
        Some(word(OFF_UID, 4) as u32),
        Some(start).filter(|s| *s > 0),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn top_lists_biggest_first_and_includes_this_process() {
        let mut reader = ProcessReader::new();
        let top = reader.top(TOP_N, &[]);
        assert!(!top.is_empty() && top.len() <= TOP_N);
        assert!(top
            .windows(2)
            .all(|w| w[0].footprint_bytes >= w[1].footprint_bytes));
        // Our own footprint is always readable; check it directly, because
        // this test process may not be among the biggest.
        let me = reader.footprint(std::process::id() as i32).unwrap();
        assert!(me > 0);
    }

    #[test]
    fn own_identity_matches_sysinfo() {
        let pid = std::process::id();
        let (uid, started) = bsd_identity(pid as i32);
        assert_eq!(uid, Some(nix::unistd::Uid::effective().as_raw()));
        let mut sys = sysinfo::System::new();
        let target = sysinfo::Pid::from_u32(pid);
        sys.refresh_processes(sysinfo::ProcessesToUpdate::Some(&[target]), true);
        // The same clock the kill guard compares against.
        assert_eq!(started, sys.process(target).map(|p| p.start_time()));
        assert!(path_of(pid as i32).is_some());
        assert!(name_of(pid as i32).is_some());
    }

    #[test]
    fn the_pid_list_is_not_truncated() {
        // `ps` counts every process; the list must be about as long, not a
        // third of it. Processes come and go, so allow a wide margin.
        let ps = std::process::Command::new("/bin/ps")
            .args(["-A", "-o", "pid="])
            .output()
            .unwrap();
        let expected = String::from_utf8_lossy(&ps.stdout).lines().count();
        let got = list_pids().len();
        assert!(got * 10 >= expected * 9, "listed {got} of about {expected}");
    }

    #[test]
    fn a_root_process_has_identity_without_a_footprint() {
        // launchd, pid 1: rusage refuses it, the BSD info does not.
        let mut reader = ProcessReader::new();
        assert_eq!(reader.footprint(1), None);
        let (uid, started) = bsd_identity(1);
        assert_eq!(uid, Some(0));
        assert!(started.is_some());
    }

    #[test]
    fn top_fills_in_what_rusage_cannot_read_and_prefers_rusage_otherwise() {
        let mut reader = ProcessReader::new();
        let me = std::process::id();
        let mine = reader.footprint(me as i32).unwrap();
        let extra = [
            // launchd is unreadable by rusage: top's number is used.
            TopRow {
                pid: 1,
                footprint_bytes: u64::MAX / 2,
                name: "launchd".into(),
            },
            // We are readable: rusage's footprint wins over this huge value.
            TopRow {
                pid: me,
                footprint_bytes: 1,
                name: "us".into(),
            },
        ];
        let top = reader.top(usize::MAX, &extra);
        let launchd = top.iter().find(|p| p.pid == 1).expect("launchd listed");
        assert_eq!(launchd.footprint_bytes, u64::MAX / 2);
        assert_eq!(launchd.uid, Some(0));
        assert_eq!(top[0].pid, 1, "biggest first");
        let us = top.iter().find(|p| p.pid == me).unwrap();
        assert!(us.footprint_bytes >= mine / 2 && us.footprint_bytes != 1);
    }

    #[test]
    fn a_pid_that_does_not_exist_is_skipped() {
        let mut reader = ProcessReader::new();
        assert_eq!(reader.footprint(i32::MAX), None);
        assert_eq!(bsd_identity(i32::MAX), (None, None));
        assert_eq!(path_of(i32::MAX), None);
    }
}
