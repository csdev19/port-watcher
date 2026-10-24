//! System health for macOS without sudo. See the README.

pub mod cli;
pub mod domain;
pub mod sampler;

#[cfg(target_os = "macos")]
pub mod events;
#[cfg(target_os = "macos")]
pub mod infra;

pub use domain::*;
pub use sampler::{Capabilities, Sampler, Sources};
