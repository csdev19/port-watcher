//! Static facts about the machine.

use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MachineInfo {
    pub chip: String,
    pub cores_p: u16,
    pub cores_e: u16,
    pub mem_total_bytes: u64,
}
