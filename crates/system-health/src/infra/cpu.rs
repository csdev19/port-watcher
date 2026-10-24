//! Per-core CPU tick snapshots (mach `host_processor_info`).

use super::ffi;
use crate::domain::{CoreKind, CoreTicks, CpuTicks};

const PROCESSOR_CPU_LOAD_INFO: i32 = 2;

/// Assumes Apple Silicon lists the efficiency cores first. Not documented and not yet verified;
/// see the README ("Core order") for the check to run. Falls back to `Unknown` without perflevel data.
pub fn core_kind(index: usize, cores_e: u16) -> CoreKind {
    if cores_e == 0 {
        CoreKind::Unknown
    } else if index < cores_e as usize {
        CoreKind::Efficiency
    } else {
        CoreKind::Performance
    }
}

pub fn read(cores_e: u16) -> Option<CpuTicks> {
    let mut cpu_count = 0u32;
    let mut info: *mut i32 = std::ptr::null_mut();
    let mut info_count = 0u32;
    let rc = unsafe {
        ffi::host_processor_info(
            ffi::mach_host_self(),
            PROCESSOR_CPU_LOAD_INFO,
            &mut cpu_count,
            &mut info,
            &mut info_count,
        )
    };
    if rc != 0 || info.is_null() {
        return None;
    }
    let slice = unsafe { std::slice::from_raw_parts(info, info_count as usize) };
    // Layout: CPU_STATE_MAX (4) natural_t per core: user, system, idle, nice.
    let (chunks, _) = slice.as_chunks::<4>();
    let cores = chunks
        .iter()
        .take(cpu_count as usize)
        .enumerate()
        .map(|(i, c)| CoreTicks {
            kind: core_kind(i, cores_e),
            ticks: [c[0] as u32, c[1] as u32, c[2] as u32, c[3] as u32],
        })
        .collect();
    unsafe {
        ffi::vm_deallocate(
            ffi::mach_task_self_,
            info as usize,
            info_count as usize * std::mem::size_of::<i32>(),
        );
    }
    Some(CpuTicks { cores })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn efficiency_cores_come_first() {
        let kinds: Vec<_> = (0..12).map(|i| core_kind(i, 4)).collect();
        assert!(kinds[..4].iter().all(|k| *k == CoreKind::Efficiency));
        assert!(kinds[4..].iter().all(|k| *k == CoreKind::Performance));
        assert_eq!(core_kind(0, 0), CoreKind::Unknown);
    }
}
