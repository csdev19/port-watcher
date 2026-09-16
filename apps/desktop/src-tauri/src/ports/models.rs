use serde::Serialize;

/// One listening port, fully enriched. Field names cross IPC as camelCase —
/// the renderer's `PortEntry` type mirrors this struct verbatim.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortEntry {
    pub port: u16,
    pub pid: u32,
    pub process_name: String,
    pub command: String,
    pub cwd: Option<String>,
    pub project: Option<String>,
    pub label: String,
    pub user: Option<String>,
    /// Epoch seconds. Doubles as the PID-reuse guard in `kill_port`.
    pub started_at: u64,
    pub memory_bytes: u64,
    pub killable: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum KillResult {
    Terminated,
    Killed,
    AlreadyGone,
    PermissionDenied,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn port_entry_serializes_camel_case() {
        let entry = PortEntry {
            port: 5173,
            pid: 4242,
            process_name: "node".into(),
            command: "node /x/vite".into(),
            cwd: Some("~/dev/laqi".into()),
            project: Some("laqi".into()),
            label: "Vite".into(),
            user: Some("cristian".into()),
            started_at: 1_757_000_000,
            memory_bytes: 123_456,
            killable: true,
        };
        let json = serde_json::to_value(&entry).unwrap();
        assert_eq!(json["processName"], "node");
        assert_eq!(json["startedAt"], 1_757_000_000_u64);
        assert_eq!(json["memoryBytes"], 123_456);
        assert!(json.get("process_name").is_none());
    }

    #[test]
    fn kill_result_serializes_as_camel_case_string() {
        assert_eq!(
            serde_json::to_value(KillResult::AlreadyGone).unwrap(),
            serde_json::json!("alreadyGone")
        );
        assert_eq!(
            serde_json::to_value(KillResult::PermissionDenied).unwrap(),
            serde_json::json!("permissionDenied")
        );
    }
}
