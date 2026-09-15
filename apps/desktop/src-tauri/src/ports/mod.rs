//! Port enumeration and process control. Split by responsibility:
//! source (listeners crate), label (rules), project (cwd walk),
//! enrich (sysinfo), kill (guards + signals).

pub mod models;
pub mod source;
