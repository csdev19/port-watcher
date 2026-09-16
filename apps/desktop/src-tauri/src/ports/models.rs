use serde::Serialize;

use super::classify::PortCategory;

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
    /// UX grouping heuristic, not a backend permission boundary.
    pub category: PortCategory,
    /// Full executable path when sysinfo can resolve it.
    pub executable_path: Option<String>,
    /// Full path through the outermost `.app` bundle component, if any.
    pub app_bundle_path: Option<String>,
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
            category: PortCategory::Dev,
            executable_path: Some("/opt/homebrew/bin/node".into()),
            app_bundle_path: None,
        };
        let json = serde_json::to_value(&entry).unwrap();
        assert_eq!(json["processName"], "node");
        assert_eq!(json["startedAt"], 1_757_000_000_u64);
        assert_eq!(json["memoryBytes"], 123_456);
        assert_eq!(json["category"], "dev");
        assert_eq!(json["executablePath"], "/opt/homebrew/bin/node");
        assert_eq!(json["appBundlePath"], serde_json::Value::Null);
        assert!(json.get("process_name").is_none());
    }

    #[test]
    fn port_entry_serializes_null_paths_not_omitted_fields() {
        let entry = PortEntry {
            port: 7000,
            pid: 88,
            process_name: "ControlCenter".into(),
            command: "/System/Library/CoreServices/ControlCenter.app/Contents/MacOS/ControlCenter"
                .into(),
            cwd: None,
            project: None,
            label: "ControlCenter".into(),
            user: Some("root".into()),
            started_at: 1_757_000_000,
            memory_bytes: 30_000_000,
            killable: false,
            category: PortCategory::System,
            executable_path: None,
            app_bundle_path: None,
        };
        let json = serde_json::to_value(&entry).unwrap();
        assert_eq!(json["category"], "system");
        assert!(json.as_object().unwrap().contains_key("executablePath"));
        assert!(json.as_object().unwrap().contains_key("appBundlePath"));
        assert_eq!(json["executablePath"], serde_json::Value::Null);
        assert_eq!(json["appBundlePath"], serde_json::Value::Null);
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
