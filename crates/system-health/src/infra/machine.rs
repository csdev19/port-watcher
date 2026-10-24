//! Static machine facts from sysctl.

use super::sysctl;
use crate::domain::MachineInfo;

pub fn read() -> MachineInfo {
    MachineInfo {
        chip: sysctl::read_string("machdep.cpu.brand_string").unwrap_or_else(|| "unknown".into()),
        cores_p: sysctl::read::<u32>("hw.perflevel0.logicalcpu").unwrap_or(0) as u16,
        cores_e: sysctl::read::<u32>("hw.perflevel1.logicalcpu").unwrap_or(0) as u16,
        mem_total_bytes: sysctl::read::<u64>("hw.memsize").unwrap_or(0),
    }
}
