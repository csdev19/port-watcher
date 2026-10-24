//! The Machine tab's backend: pure shaping of System health data for the panel. Nothing here
//! touches Tauri or the OS; `health.rs` owns the sampler and `commands.rs` the IPC surface.
//! Per-process kills reuse `ports::kill` (ADR 0006); this module only decides what to show.

pub mod dto;
pub mod gauges;
pub mod history;
pub mod runtime;
pub mod top;
