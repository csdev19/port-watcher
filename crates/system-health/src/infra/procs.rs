//! Per-process counters from libproc: `proc_pid_rusage` gives CPU time, physical footprint and
//! energy for every process the user can see, in under a millisecond.

use super::ffi;
use crate::domain::attribution::{ProcessCounters, ticks_to_ns};
use std::collections::{HashMap, HashSet};
use std::ffi::c_void;

const RUSAGE_INFO_V4: i32 = 4;
const RUSAGE_INFO_V6: i32 = 6;

/// `rusage_info_v6` (sys/resource.h). Older flavors are a prefix of this layout, and the kernel
/// writes only as much as the requested flavor holds, so the tail stays zero for V4.
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
    // child_user .. runnable_time: unused here.
    _v4_tail: [u64; 25],
    flags: u64,
    user_ptime: u64,
    system_ptime: u64,
    pinstructions: u64,
    pcycles: u64,
    energy_nj: u64,
    _v6_tail: [u64; 15],
}

fn timebase() -> (u32, u32) {
    let mut info = ffi::MachTimebaseInfo { numer: 0, denom: 0 };
    unsafe { ffi::mach_timebase_info(&mut info) };
    if info.denom == 0 {
        (1, 1)
    } else {
        (info.numer, info.denom)
    }
}

const PROC_PIDTBSDINFO: i32 = 3;
const PROC_PIDPATHINFO_MAXSIZE: usize = 4096;

/// A process incarnation: PID plus start time, so a reused PID is a different key.
type Incarnation = (i32, u64);
/// Executable path, owner uid and BSD start time in epoch seconds.
type Identity = (Option<String>, Option<u32>, Option<u64>);

/// Path and owner never change for one incarnation, so each process pays the two syscalls once.
/// Entries of processes that left the walk are dropped, which bounds the size.
#[derive(Default)]
struct IdentityCache {
    map: HashMap<Incarnation, Identity>,
}

impl IdentityCache {
    fn get_or_insert_with(
        &mut self,
        key: Incarnation,
        load: impl FnOnce() -> Identity,
    ) -> Identity {
        self.map.entry(key).or_insert_with(load).clone()
    }

    fn retain_live(&mut self, live: &HashSet<Incarnation>) {
        self.map.retain(|k, _| live.contains(k));
    }
}

pub struct ProcessReader {
    numer: u32,
    denom: u32,
    /// Flavor that worked last time; V6 is tried first and V4 is the fallback.
    flavor: i32,
    identities: IdentityCache,
    /// Cache keys touched by the walk in progress; the rest are dropped when it ends.
    seen: HashSet<Incarnation>,
}

impl Default for ProcessReader {
    fn default() -> Self {
        Self::new()
    }
}

impl ProcessReader {
    pub fn new() -> Self {
        let (numer, denom) = timebase();
        Self {
            numer,
            denom,
            flavor: RUSAGE_INFO_V6,
            identities: IdentityCache::default(),
            seen: HashSet::new(),
        }
    }

    /// Whether the OS reports per-process energy (needs the V6 flavor).
    pub fn energy_supported(&mut self) -> bool {
        self.read_one(std::process::id() as i32, false)
            .is_some_and(|c| c.energy_nj.is_some())
    }

    fn rusage(&mut self, pid: i32) -> Option<RusageInfo> {
        let mut info = RusageInfo::default();
        let rc =
            unsafe { ffi::proc_pid_rusage(pid, self.flavor, &mut info as *mut _ as *mut c_void) };
        if rc == 0 {
            return Some(info);
        }
        if self.flavor == RUSAGE_INFO_V6 {
            let mut info = RusageInfo::default();
            let rc = unsafe {
                ffi::proc_pid_rusage(pid, RUSAGE_INFO_V4, &mut info as *mut _ as *mut c_void)
            };
            if rc == 0 {
                // Only downgrade for good when V4 works for a process V6 rejects.
                self.flavor = RUSAGE_INFO_V4;
                return Some(info);
            }
        }
        None
    }

    fn read_one(&mut self, pid: i32, with_name: bool) -> Option<ProcessCounters> {
        self.read_one_with(pid, with_name, false)
    }

    fn read_one_with(
        &mut self,
        pid: i32,
        with_name: bool,
        with_identity: bool,
    ) -> Option<ProcessCounters> {
        let info = self.rusage(pid)?;
        let name = if with_name {
            name_of(pid)
        } else {
            String::new()
        };
        let energy_nj = (self.flavor == RUSAGE_INFO_V6).then_some(info.energy_nj);
        let started_at = ticks_to_ns(info.proc_start_abstime, self.numer, self.denom);
        let (path, uid, start_secs) = if with_identity {
            self.seen.insert((pid, started_at));
            self.identities.get_or_insert_with((pid, started_at), || {
                let (uid, start) = bsd_identity(pid);
                (path_of(pid), uid, start)
            })
        } else {
            (None, None, None)
        };
        // Epoch seconds, the same clock the ports list and the kill guard use, so a PID plus
        // start time names one process everywhere. Falls back to the machine clock only when
        // the BSD info is unreadable (processes of other users), which the kill guard rejects.
        let started_at = start_secs.unwrap_or(started_at);
        Some(ProcessCounters {
            pid: pid as u32,
            name,
            started_at,
            cpu_time_ns: ticks_to_ns(
                info.user_time.saturating_add(info.system_time),
                self.numer,
                self.denom,
            ),
            footprint_bytes: info.phys_footprint,
            energy_nj,
            path,
            uid,
        })
    }

    /// Counters for every process readable by the current user. Other users' processes are
    /// invisible without sudo and are skipped.
    pub fn read_all(&mut self) -> Vec<ProcessCounters> {
        self.seen.clear();
        let all: Vec<ProcessCounters> = list_pids()
            .into_iter()
            .filter_map(|pid| self.read_one_with(pid, true, true))
            .collect();
        self.identities.retain_live(&self.seen);
        all
    }
}

fn list_pids() -> Vec<i32> {
    let bytes = unsafe { ffi::proc_listallpids(std::ptr::null_mut(), 0) };
    if bytes <= 0 {
        return Vec::new();
    }
    // Headroom: processes can start between the two calls.
    let mut pids = vec![0i32; bytes as usize / std::mem::size_of::<i32>() + 64];
    let got = unsafe {
        ffi::proc_listallpids(
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

fn name_of(pid: i32) -> String {
    let mut buf = [0u8; 256];
    let n = unsafe { ffi::proc_name(pid, buf.as_mut_ptr() as *mut c_void, buf.len() as u32) };
    if n <= 0 {
        return format!("pid {pid}");
    }
    String::from_utf8_lossy(&buf[..n as usize]).into_owned()
}

fn path_of(pid: i32) -> Option<String> {
    let mut buf = vec![0u8; PROC_PIDPATHINFO_MAXSIZE];
    let n = unsafe { ffi::proc_pidpath(pid, buf.as_mut_ptr() as *mut c_void, buf.len() as u32) };
    if n <= 0 {
        return None;
    }
    Some(String::from_utf8_lossy(&buf[..n as usize]).into_owned())
}

fn bsd_identity(pid: i32) -> (Option<u32>, Option<u64>) {
    // SAFETY: proc_bsdinfo is plain old data; the kernel fills at most `size_of` bytes.
    let mut info: libc::proc_bsdinfo = unsafe { std::mem::zeroed() };
    let size = std::mem::size_of::<libc::proc_bsdinfo>() as i32;
    let n = unsafe {
        ffi::proc_pidinfo(
            pid,
            PROC_PIDTBSDINFO,
            0,
            &mut info as *mut _ as *mut c_void,
            size,
        )
    };
    if n != size {
        return (None, None);
    }
    (Some(info.pbi_uid), Some(info.pbi_start_tvsec))
}

// Layout checked against `sizeof`/`offsetof` of `struct rusage_info_v6` in the macOS SDK.
const _: () = {
    assert!(std::mem::size_of::<RusageInfo>() == 464);
    assert!(std::mem::offset_of!(RusageInfo, phys_footprint) == 72);
    assert!(std::mem::offset_of!(RusageInfo, proc_start_abstime) == 80);
    assert!(std::mem::offset_of!(RusageInfo, flags) == 296);
    assert!(std::mem::offset_of!(RusageInfo, energy_nj) == 336);
};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identity_is_loaded_once_per_incarnation() {
        let mut cache = IdentityCache::default();
        let mut loads = 0;
        for _ in 0..3 {
            let id = cache.get_or_insert_with((10, 1), || {
                loads += 1;
                (Some("/bin/x".into()), Some(501), Some(1_700_000_000))
            });
            assert_eq!(id, (Some("/bin/x".into()), Some(501), Some(1_700_000_000)));
        }
        assert_eq!(loads, 1);
        // A reused PID with another start time is a new incarnation.
        cache.get_or_insert_with((10, 2), || {
            loads += 1;
            (None, None, None)
        });
        assert_eq!(loads, 2);
    }

    #[test]
    fn cache_drops_incarnations_that_left_the_walk() {
        let mut cache = IdentityCache::default();
        cache.get_or_insert_with((1, 1), || (None, None, None));
        cache.get_or_insert_with((2, 1), || (None, None, None));
        cache.retain_live(&HashSet::from([(2, 1)]));
        assert_eq!(cache.map.keys().copied().collect::<Vec<_>>(), [(2, 1)]);
    }

    #[test]
    fn own_process_has_path_and_uid_when_hardware_tests_are_on() {
        if std::env::var("CHAPAY_HW_TESTS").is_err() {
            return;
        }
        let mut reader = ProcessReader::new();
        let me = std::process::id();
        let row = reader
            .read_all()
            .into_iter()
            .find(|c| c.pid == me)
            .expect("own pid is listed");
        assert_eq!(row.uid, Some(unsafe { libc::geteuid() }));
        // Epoch seconds, not machine-clock nanoseconds: the kill guard compares it to sysinfo.
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        assert!(row.started_at > 1_600_000_000 && row.started_at <= now + 1);
        let exe = std::env::current_exe().unwrap();
        let name = exe.file_name().unwrap().to_str().unwrap();
        assert!(row.path.unwrap().ends_with(name));
    }
}
