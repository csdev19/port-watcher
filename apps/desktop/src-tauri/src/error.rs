use serde::{Serialize, Serializer};

/// Errors crossing IPC serialize as their display string — the renderer
/// shows them in the error state and never matches on variants.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("failed to read listening ports: {0}")]
    PortSource(String),
    #[error("internal error: {0}")]
    Internal(String),
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}
