//! Memory guard: system memory and per-process physical footprint, the
//! verdict built from them, the local history and the Terminal command for a
//! process chapay may not kill (ADRs 0011 and 0012, spec
//! docs/specs/2026-11-07-memory-guard-design.md).
//!
//! The readers are ported from `feat/chapay-v2` `crates/system-health`
//! (`infra/{memory,procs,sysctl,ffi}.rs`, `domain/memory.rs`); only what the
//! `MemoryReading` contract needs came over.

pub mod api;
pub mod launchd;
pub mod procs;
pub mod reading;
pub mod sampler;
pub mod store;
pub mod topcmd;
pub mod verdict;
