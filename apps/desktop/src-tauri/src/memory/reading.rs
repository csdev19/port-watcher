//! System-wide memory: Activity Monitor's breakdown from `host_statistics64`,
//! swap from `vm.swapusage`, total from `hw.memsize` and the OS's own
//! pressure level. Ported from feat/chapay-v2 crates/system-health
//! (`infra/memory.rs`, `infra/sysctl.rs`, `domain/memory.rs`).

use std::ffi::{c_void, CString};

use serde::{Deserialize, Serialize};

/// The OS's judgement of memory pressure. Ordered, so `>= Warning` works.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MemoryPressure {
    Normal,
    Warning,
    Critical,
}

impl MemoryPressure {
    /// `kern.memorystatus_vm_pressure_level`: 1 normal, 2 warning, 4 critical.
    /// Anything else reads as normal.
    pub fn from_sysctl_level(level: u32) -> Self {
        match level {
            2 => Self::Warning,
            4 => Self::Critical,
            _ => Self::Normal,
        }
    }

    /// The value stored in the history file.
    pub fn as_i64(self) -> i64 {
        match self {
            Self::Normal => 0,
            Self::Warning => 1,
            Self::Critical => 2,
        }
    }

    pub fn from_i64(v: i64) -> Self {
        match v {
            1 => Self::Warning,
            2 => Self::Critical,
            _ => Self::Normal,
        }
    }
}

/// One reading of the whole machine. All sizes are bytes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SystemMemory {
    pub total_bytes: u64,
    /// App + wired + compressed, as Activity Monitor adds them up.
    pub used_bytes: u64,
    pub compressed_bytes: u64,
    pub swap_used_bytes: u64,
    pub swap_total_bytes: u64,
    pub pressure: MemoryPressure,
}

#[repr(C)]
#[derive(Default)]
struct VmStats64 {
    free_count: u32,
    active_count: u32,
    inactive_count: u32,
    wire_count: u32,
    zero_fill_count: u64,
    reactivations: u64,
    pageins: u64,
    pageouts: u64,
    faults: u64,
    cow_faults: u64,
    lookups: u64,
    hits: u64,
    purges: u64,
    purgeable_count: u32,
    speculative_count: u32,
    decompressions: u64,
    compressions: u64,
    swapins: u64,
    swapouts: u64,
    compressor_page_count: u32,
    throttled_count: u32,
    external_page_count: u32,
    internal_page_count: u32,
    total_uncompressed_pages_in_compressor: u64,
}

#[repr(C)]
#[derive(Default)]
struct XswUsage {
    total: u64,
    avail: u64,
    used: u64,
    pagesize: u32,
    encrypted: u8,
}

/// `HOST_VM_INFO64`.
const HOST_VM_INFO64: i32 = 4;

extern "C" {
    fn mach_host_self() -> u32;
    fn host_statistics64(host: u32, flavor: i32, info: *mut i32, count: *mut u32) -> i32;
}

/// Reads a fixed-size value. `None` when the name does not exist or the size
/// does not match what the kernel returned.
fn sysctl<T: Default>(name: &str) -> Option<T> {
    let name = CString::new(name).ok()?;
    let mut v = T::default();
    let mut len = std::mem::size_of::<T>();
    // SAFETY: `v` is a plain-old-data value of `len` bytes; the kernel writes
    // at most `len` bytes and reports how many.
    let rc = unsafe {
        libc::sysctlbyname(
            name.as_ptr(),
            &mut v as *mut T as *mut c_void,
            &mut len,
            std::ptr::null_mut(),
            0,
        )
    };
    (rc == 0 && len == std::mem::size_of::<T>()).then_some(v)
}

/// Memory as it is right now. `None` when the figures that define the
/// verdict (total RAM, the VM statistics) cannot be read; a missing swap or
/// pressure sysctl only reads as zero swap and normal pressure.
pub fn read_system() -> Option<SystemMemory> {
    let total_bytes = sysctl::<u64>("hw.memsize").filter(|t| *t > 0)?;
    let mut vm = VmStats64::default();
    let mut count = (std::mem::size_of::<VmStats64>() / 4) as u32;
    // SAFETY: `vm` is repr(C) and `count` is its size in 32-bit words, which
    // is what host_statistics64 expects for HOST_VM_INFO64.
    let rc = unsafe {
        host_statistics64(
            mach_host_self(),
            HOST_VM_INFO64,
            &mut vm as *mut _ as *mut i32,
            &mut count,
        )
    };
    if rc != 0 {
        return None;
    }
    let page = sysctl::<u64>("hw.pagesize").unwrap_or(16384);
    let swap = sysctl::<XswUsage>("vm.swapusage").unwrap_or_default();
    let app = u64::from(vm.internal_page_count.saturating_sub(vm.purgeable_count)) * page;
    let wired = u64::from(vm.wire_count) * page;
    let compressed = u64::from(vm.compressor_page_count) * page;
    Some(SystemMemory {
        total_bytes,
        used_bytes: app + wired + compressed,
        compressed_bytes: compressed,
        swap_used_bytes: swap.used,
        swap_total_bytes: swap.total,
        pressure: sysctl::<u32>("kern.memorystatus_vm_pressure_level")
            .map(MemoryPressure::from_sysctl_level)
            .unwrap_or(MemoryPressure::Normal),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sysctl_levels_map_to_pressure() {
        assert_eq!(MemoryPressure::from_sysctl_level(1), MemoryPressure::Normal);
        assert_eq!(
            MemoryPressure::from_sysctl_level(2),
            MemoryPressure::Warning
        );
        assert_eq!(
            MemoryPressure::from_sysctl_level(4),
            MemoryPressure::Critical
        );
        assert_eq!(
            MemoryPressure::from_sysctl_level(99),
            MemoryPressure::Normal
        );
    }

    #[test]
    fn pressure_round_trips_through_the_stored_integer() {
        for p in [
            MemoryPressure::Normal,
            MemoryPressure::Warning,
            MemoryPressure::Critical,
        ] {
            assert_eq!(MemoryPressure::from_i64(p.as_i64()), p);
        }
        assert!(MemoryPressure::Critical > MemoryPressure::Warning);
    }

    #[test]
    fn this_machine_reports_sane_figures() {
        let m = read_system().expect("host statistics readable");
        assert!(m.total_bytes >= 1 << 30);
        assert!(m.used_bytes > 0 && m.used_bytes <= m.total_bytes * 2);
        assert!(m.compressed_bytes <= m.used_bytes);
        assert!(m.swap_used_bytes <= m.swap_total_bytes);
    }
}
