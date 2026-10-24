//! macOS adapters. All `unsafe` in the crate lives here and in `events`.
//!
//! Every source degrades to `None` instead of failing the sample (ADR 0010).

pub(crate) mod ffi;

pub mod cpu;
pub mod gpu;
pub mod mac_sources;
pub mod machine;
pub mod memory;
pub mod procs;
pub mod smc;
pub mod sysctl;
pub mod thermal;
