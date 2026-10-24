//! Memory usage and memory pressure.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum MemoryPressure {
    Normal,
    Warning,
    Critical,
}

impl MemoryPressure {
    /// `kern.memorystatus_vm_pressure_level`: 1 normal, 2 warning, 4 critical.
    pub fn from_sysctl_level(level: u32) -> Self {
        match level {
            2 => Self::Warning,
            4 => Self::Critical,
            _ => Self::Normal,
        }
    }

    /// `dispatch_source_get_data` flags: 0x1 normal, 0x2 warn, 0x4 critical. The kernel may
    /// OR several bits; the most severe wins.
    pub fn from_dispatch_flags(flags: u64) -> Self {
        if flags & 0x4 != 0 {
            Self::Critical
        } else if flags & 0x2 != 0 {
            Self::Warning
        } else {
            Self::Normal
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Normal => "normal",
            Self::Warning => "warning",
            Self::Critical => "critical",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Memory {
    pub total_bytes: u64,
    pub used_bytes: u64,
    pub compressed_bytes: u64,
    pub swap_bytes: u64,
    /// The system "memory free percentage" (`kern.memorystatus_level`).
    pub free_pct: u8,
    pub pressure: MemoryPressure,
}

pub const GB: f32 = 1024.0 * 1024.0 * 1024.0;

impl Memory {
    pub fn used_gb(&self) -> f32 {
        self.used_bytes as f32 / GB
    }
    pub fn total_gb(&self) -> f32 {
        self.total_bytes as f32 / GB
    }
    pub fn compressed_gb(&self) -> f32 {
        self.compressed_bytes as f32 / GB
    }
    pub fn swap_gb(&self) -> f32 {
        self.swap_bytes as f32 / GB
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sysctl_levels() {
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
    fn dispatch_flags() {
        assert_eq!(
            MemoryPressure::from_dispatch_flags(0x1),
            MemoryPressure::Normal
        );
        assert_eq!(
            MemoryPressure::from_dispatch_flags(0x2),
            MemoryPressure::Warning
        );
        assert_eq!(
            MemoryPressure::from_dispatch_flags(0x4),
            MemoryPressure::Critical
        );
        assert_eq!(
            MemoryPressure::from_dispatch_flags(0x6),
            MemoryPressure::Critical
        );
        assert_eq!(
            MemoryPressure::from_dispatch_flags(0),
            MemoryPressure::Normal
        );
    }
}
