//! The Terminal command for a process chapay may not kill (ADR 0012). chapay
//! only builds the text; it never runs `sudo`, `osascript` or a helper.
//!
//! The service label comes only from a `/Library/LaunchDaemons/*.plist` whose
//! `Program` or `ProgramArguments[0]` equals the process's executable path.
//! No match means the fallback `sudo kill <pid>`.

use std::path::Path;

use serde::Serialize;

/// Where third-party launch daemons live.
pub const DAEMONS_DIR: &str = "/Library/LaunchDaemons";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CommandKind {
    Kickstart,
    Kill,
}

/// What the Memory tab prints for a process Kill cannot reach.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryCommand {
    /// `sudo launchctl kickstart -k system/com.x.y` or `sudo kill 123`.
    pub text: String,
    pub kind: CommandKind,
    /// One line of context (ADR 0012).
    pub note: String,
    pub security_vendor: Option<String>,
}

/// One launch daemon definition: its label and the program it starts.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Daemon {
    pub label: String,
    pub program: String,
}

/// Endpoint-security vendors whose directory in an executable path earns the
/// "check your IT policy" line. Matched case-insensitively on the path.
const SECURITY_VENDORS: [(&str, &str); 4] = [
    ("zscaler", "Zscaler"),
    ("crowdstrike", "CrowdStrike"),
    ("avira", "Avira"),
    ("sentinelone", "SentinelOne"),
];

/// A label is pasted into a Terminal, so only the characters launchd labels
/// use are accepted. Anything else is treated as "no label found".
fn is_safe_label(label: &str) -> bool {
    !label.is_empty()
        && label.len() <= 200
        && label
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

/// The label and program of one plist, `None` when it is unreadable, not a
/// dictionary, or has no label or program.
fn read_daemon(path: &Path) -> Option<Daemon> {
    let value = plist::Value::from_file(path).ok()?;
    let dict = value.as_dictionary()?;
    let label = dict.get("Label")?.as_string()?.to_owned();
    let program = dict
        .get("Program")
        .and_then(|v| v.as_string())
        .map(str::to_owned)
        .or_else(|| {
            dict.get("ProgramArguments")?
                .as_array()?
                .first()?
                .as_string()
                .map(str::to_owned)
        })?;
    Some(Daemon { label, program })
}

/// Every readable `*.plist` in `dir`. Unreadable files are skipped: a daemon
/// plist this user cannot read just never matches.
pub fn scan_daemons(dir: &Path) -> Vec<Daemon> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut paths: Vec<_> = entries
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|x| x == "plist"))
        .collect();
    paths.sort();
    paths.iter().filter_map(|p| read_daemon(p)).collect()
}

/// The label of the daemon that starts `executable`, from already scanned
/// daemons. The first match in file-name order wins.
pub fn label_in(daemons: &[Daemon], executable: &str) -> Option<String> {
    daemons
        .iter()
        .find(|d| d.program == executable && is_safe_label(&d.label))
        .map(|d| d.label.clone())
}

/// The label of the daemon that starts `executable`, scanning `dir`. The
/// app scans once per reading (`scan_daemons` + `command_for`); this is the
/// single-lookup form the tests use.
#[cfg(test)]
fn label_for_executable_in(dir: &Path, executable: &str) -> Option<String> {
    label_in(&scan_daemons(dir), executable)
}

fn vendor_of(executable: Option<&str>) -> Option<&'static str> {
    let lower = executable?.to_ascii_lowercase();
    SECURITY_VENDORS
        .iter()
        .find(|(needle, _)| lower.contains(needle))
        .map(|(_, name)| *name)
}

/// The command card for one process. `daemons` is the result of
/// `scan_daemons`, scanned once for all the rows of a reading. `user` is the
/// owner's name when known, for the note.
pub fn command_for(
    pid: u32,
    executable: Option<&str>,
    user: Option<&str>,
    daemons: &[Daemon],
) -> MemoryCommand {
    let label = executable.and_then(|exe| label_in(daemons, exe));
    let vendor = vendor_of(executable);

    let (text, kind, tail) = match label {
        Some(label) => (
            format!("sudo launchctl kickstart -k system/{label}"),
            CommandKind::Kickstart,
            "Paste it in Terminal to restart the service.",
        ),
        None => (
            format!("sudo kill {pid}"),
            CommandKind::Kill,
            "launchd restarts it if it is a service.",
        ),
    };
    let who = match user {
        Some(u) => format!("Runs as {u}; chapay cannot stop it."),
        None => "chapay cannot stop it.".to_owned(),
    };
    // The vendor line is the renderer's, built from `security_vendor`; the
    // note stays the one line of context.
    let note = format!("{who} {tail}");
    MemoryCommand {
        text,
        kind,
        note,
        security_vendor: vendor.map(str::to_owned),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_plist(dir: &Path, file: &str, body: &str) {
        let xml = format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
             <!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \
             \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n\
             <plist version=\"1.0\"><dict>{body}</dict></plist>"
        );
        std::fs::write(dir.join(file), xml).unwrap();
    }

    const ZDPD: &str = "/Library/Application Support/Zscaler/Zscaler.app/Contents/PlugIns/zdpd";

    fn fixture() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        write_plist(
            dir.path(),
            "com.zscaler.zdp.pd.plist",
            &format!(
                "<key>Label</key><string>com.zscaler.zdp.pd</string>\
                 <key>ProgramArguments</key><array><string>{ZDPD}</string>\
                 <string>--daemon</string></array>"
            ),
        );
        write_plist(
            dir.path(),
            "com.example.tool.plist",
            "<key>Label</key><string>com.example.tool</string>\
             <key>Program</key><string>/usr/local/bin/tool</string>",
        );
        write_plist(
            dir.path(),
            "com.example.nolabel.plist",
            "<key>Program</key><string>/usr/local/bin/nolabel</string>",
        );
        std::fs::write(dir.path().join("broken.plist"), b"not a plist").unwrap();
        std::fs::write(dir.path().join("notes.txt"), b"ignored").unwrap();
        dir
    }

    #[test]
    fn finds_the_label_by_program_arguments_zero() {
        let d = fixture();
        assert_eq!(
            label_for_executable_in(d.path(), ZDPD).as_deref(),
            Some("com.zscaler.zdp.pd")
        );
    }

    #[test]
    fn finds_the_label_by_program() {
        let d = fixture();
        assert_eq!(
            label_for_executable_in(d.path(), "/usr/local/bin/tool").as_deref(),
            Some("com.example.tool")
        );
    }

    #[test]
    fn no_match_for_other_paths_missing_labels_or_a_missing_dir() {
        let d = fixture();
        assert_eq!(label_for_executable_in(d.path(), "/usr/bin/other"), None);
        // Only the exact path matches, not a prefix or the base name.
        assert_eq!(label_for_executable_in(d.path(), "/usr/local/bin"), None);
        assert_eq!(
            label_for_executable_in(d.path(), "/usr/local/bin/nolabel"),
            None
        );
        assert_eq!(
            label_for_executable_in(Path::new("/definitely/not/here"), ZDPD),
            None
        );
    }

    #[test]
    fn a_label_with_shell_characters_is_never_used() {
        let dir = tempfile::tempdir().unwrap();
        write_plist(
            dir.path(),
            "evil.plist",
            "<key>Label</key><string>x; rm -rf ~</string>\
             <key>Program</key><string>/opt/evil</string>",
        );
        assert_eq!(label_for_executable_in(dir.path(), "/opt/evil"), None);
        let daemons = scan_daemons(dir.path());
        let c = command_for(900, Some("/opt/evil"), Some("root"), &daemons);
        assert_eq!(c.text, "sudo kill 900");
        assert_eq!(c.kind, CommandKind::Kill);
    }

    #[test]
    fn a_daemon_gets_kickstart_with_its_label_and_the_vendor_line() {
        let d = fixture();
        let daemons = scan_daemons(d.path());
        let c = command_for(1101, Some(ZDPD), Some("root"), &daemons);
        assert_eq!(
            c.text,
            "sudo launchctl kickstart -k system/com.zscaler.zdp.pd"
        );
        assert_eq!(c.kind, CommandKind::Kickstart);
        assert_eq!(c.security_vendor.as_deref(), Some("Zscaler"));
        assert!(
            c.note.starts_with("Runs as root; chapay cannot stop it."),
            "{}",
            c.note
        );
        assert!(
            !c.note.contains("IT policy"),
            "the vendor line is the renderer's"
        );
        assert!(!c.note.contains("Zscaler"));
        assert!(!c.note.contains('\n'));
    }

    #[test]
    fn without_a_daemon_the_fallback_is_sudo_kill_and_says_launchd_restarts_it() {
        let c = command_for(123, Some("/usr/local/bin/other"), Some("root"), &[]);
        assert_eq!(c.text, "sudo kill 123");
        assert_eq!(c.kind, CommandKind::Kill);
        assert_eq!(c.security_vendor, None);
        assert!(c.note.contains("launchd restarts it if it is a service"));
        assert!(!c.note.contains("IT policy"));
    }

    #[test]
    fn an_unknown_path_and_owner_still_give_a_command() {
        let c = command_for(77, None, None, &[]);
        assert_eq!(c.text, "sudo kill 77");
        assert!(c.note.starts_with("chapay cannot stop it."));
    }

    #[test]
    fn every_listed_vendor_is_recognised_case_insensitively() {
        for (path, vendor) in [
            ("/Library/CrowdStrike/falcond", "CrowdStrike"),
            ("/Applications/Avira/avira-daemon", "Avira"),
            (
                "/Library/Sentinel/sentinel-agent.bundle/SentinelOne/x",
                "SentinelOne",
            ),
            ("/Library/Application Support/ZSCALER/zdpd", "Zscaler"),
        ] {
            assert_eq!(vendor_of(Some(path)), Some(vendor), "{path}");
        }
        assert_eq!(vendor_of(Some("/usr/bin/node")), None);
        assert_eq!(vendor_of(None), None);
    }
}
