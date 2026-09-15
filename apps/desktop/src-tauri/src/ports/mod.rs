//! Port enumeration and process control. Split by responsibility:
//! source (listeners crate), label (rules), project (cwd walk),
//! enrich (sysinfo), kill (guards + signals).

pub mod enrich;
pub mod kill;
pub mod label;
pub mod models;
pub mod project;
pub mod source;
