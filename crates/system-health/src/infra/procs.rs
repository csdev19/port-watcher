//! Per-process counters from libproc: `proc_pid_rusage` gives CPU time, physical footprint and
//! energy for every process the user can see, in under a millisecond.

use super::ffi;
use crate::domain::attribution::{ProcessCounters, ticks_to_ns};
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

pub struct ProcessReader {
    numer: u32,
    denom: u32,
    /// Flavor that worked last time; V6 is tried first and V4 is the fallback.
    flavor: i32,
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
        let info = self.rusage(pid)?;
        let name = if with_name {
            name_of(pid)
        } else {
            String::new()
        };
        let energy_nj = (self.flavor == RUSAGE_INFO_V6).then_some(info.energy_nj);
        Some(ProcessCounters {
            pid: pid as u32,
            name,
            started_at: ticks_to_ns(info.proc_start_abstime, self.numer, self.denom),
            cpu_time_ns: ticks_to_ns(
                info.user_time.saturating_add(info.system_time),
                self.numer,
                self.denom,
            ),
            footprint_bytes: info.phys_footprint,
            energy_nj,
            cpu_pct_hint: None,
        })
    }

    /// Counters for every process readable by the current user. Other users' processes fail
    /// with `EPERM` without sudo and are skipped here; `super::ps` fills them in.
    pub fn read_all(&mut self) -> Vec<ProcessCounters> {
        list_pids()
            .into_iter()
            .filter_map(|pid| self.read_one(pid, true))
            .collect()
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

// Layout checked against `sizeof`/`offsetof` of `struct rusage_info_v6` in the macOS SDK.
const _: () = {
    assert!(std::mem::size_of::<RusageInfo>() == 464);
    assert!(std::mem::offset_of!(RusageInfo, phys_footprint) == 72);
    assert!(std::mem::offset_of!(RusageInfo, proc_start_abstime) == 80);
    assert!(std::mem::offset_of!(RusageInfo, flags) == 296);
    assert!(std::mem::offset_of!(RusageInfo, energy_nj) == 336);
};
