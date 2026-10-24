//! System health for macOS without sudo. See the README.

pub mod domain;

#[cfg(target_os = "macos")]
pub mod events;
#[cfg(target_os = "macos")]
pub mod infra;

pub use domain::*;
