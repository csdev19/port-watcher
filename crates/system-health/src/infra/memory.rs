//! Memory usage (mach `host_statistics64`) and pressure level (sysctl).

use super::{ffi, sysctl};
use crate::domain::{Memory, MemoryPressure};

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

pub fn pressure() -> Option<MemoryPressure> {
    sysctl::read::<u32>("kern.memorystatus_vm_pressure_level")
        .map(MemoryPressure::from_sysctl_level)
}

pub fn read() -> Memory {
    let mut vm = VmStats64::default();
    let mut count = (std::mem::size_of::<VmStats64>() / 4) as u32;
    let rc = unsafe {
        ffi::host_statistics64(
            ffi::mach_host_self(),
            4,
            &mut vm as *mut _ as *mut i32,
            &mut count,
        )
    };
    let page = sysctl::read::<u64>("hw.pagesize").unwrap_or(16384);
    let swap = sysctl::read::<XswUsage>("vm.swapusage").unwrap_or_default();
    // Same breakdown Activity Monitor uses: app + wired + compressed.
    let (used, compressed) = if rc == 0 {
        let app = vm.internal_page_count.saturating_sub(vm.purgeable_count) as u64 * page;
        let wired = vm.wire_count as u64 * page;
        let compressed = vm.compressor_page_count as u64 * page;
        (app + wired + compressed, compressed)
    } else {
        (0, 0)
    };
    Memory {
        total_bytes: sysctl::read::<u64>("hw.memsize").unwrap_or(0),
        used_bytes: used,
        compressed_bytes: compressed,
        swap_bytes: swap.used,
        free_pct: sysctl::read::<u32>("kern.memorystatus_level")
            .unwrap_or(0)
            .min(100) as u8,
        pressure: pressure().unwrap_or(MemoryPressure::Normal),
    }
}
