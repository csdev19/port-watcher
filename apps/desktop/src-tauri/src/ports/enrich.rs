use std::path::Path;

use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind, Users};

use super::classify::{app_bundle_path, classify_port};
use super::label::label_for;
use super::models::PortEntry;
use super::project::{detect_project, tildify};
use super::source::RawPort;

/// Join sysinfo data onto the raw listener rows. A PID that vanished
/// between the listeners call and here still yields a row (minimal data)
/// rather than disappearing mid-poll.
pub fn enrich(raw: Vec<RawPort>) -> Vec<PortEntry> {
    let mut sys = System::new();
    sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing()
            .with_memory()
            .with_cmd(UpdateKind::Always)
            .with_cwd(UpdateKind::Always)
            .with_user(UpdateKind::Always)
            .with_exe(UpdateKind::Always),
    );
    let users = Users::new_with_refreshed_list();
    let my_uid = nix::unistd::Uid::effective().as_raw();
    let self_pid = std::process::id();
    let home = std::env::var("HOME").ok();

    raw.into_iter()
        .map(|r| entry_for(r, &sys, &users, my_uid, self_pid, home.as_deref()))
        .collect()
}

fn entry_for(
    raw: RawPort,
    sys: &System,
    users: &Users,
    my_uid: u32,
    self_pid: u32,
    home: Option<&str>,
) -> PortEntry {
    let proc = sys.process(Pid::from_u32(raw.pid));

    let command = proc
        .map(|p| {
            p.cmd()
                .iter()
                .map(|s| s.to_string_lossy())
                .collect::<Vec<_>>()
                .join(" ")
        })
        .filter(|c| !c.is_empty())
        .unwrap_or_else(|| raw.process_name.clone());

    let cwd_raw = proc.and_then(|p| p.cwd()).map(|p| p.display().to_string());
    let project = cwd_raw
        .as_deref()
        .and_then(|c| detect_project(Path::new(c)));
    let cwd = cwd_raw.map(|c| tildify(&c, home));

    let uid = proc.and_then(|p| p.user_id());
    let owner_uid = uid.map(|u| **u);
    let same_user = owner_uid.map(|u| u == my_uid).unwrap_or(false);

    let executable = proc
        .and_then(|p| p.exe())
        .filter(|p| !p.as_os_str().is_empty());
    let category = classify_port(owner_uid, my_uid, executable);
    let executable_path = executable.map(|p| p.to_string_lossy().into_owned());
    let app_bundle_path = executable
        .and_then(app_bundle_path)
        .map(|p| p.to_string_lossy().into_owned());

    PortEntry {
        port: raw.port,
        pid: raw.pid,
        label: label_for(&command, &raw.process_name),
        command,
        cwd,
        project,
        user: uid
            .and_then(|u| users.get_user_by_id(u))
            .map(|u| u.name().to_string()),
        started_at: proc.map(|p| p.start_time()).unwrap_or(0),
        memory_bytes: proc.map(|p| p.memory()).unwrap_or(0),
        killable: same_user && crate::ports::kill::static_guard(raw.pid, self_pid).is_none(),
        process_name: raw.process_name,
        category,
        executable_path,
        app_bundle_path,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// End-to-end against the live machine: spawn a real TCP listener and
    /// find ourselves through the whole pipeline.
    #[test]
    fn finds_our_own_test_listener() {
        use std::net::TcpListener;
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();

        let raw = crate::ports::source::raw_ports().expect("raw_ports failed");
        let entries = enrich(raw);
        let me = entries
            .iter()
            .find(|e| e.port == port)
            .expect("our test listener should be in the list");

        assert_eq!(me.pid, std::process::id());
        // Our own PID is never killable (self-kill guard).
        assert!(!me.killable);
        assert!(me.started_at > 0);
        assert!(
            !me.command.is_empty() && me.command != me.process_name,
            "cmd not populated"
        );
        assert!(me.cwd.is_some(), "cwd not populated");
        assert!(me.user.is_some());
        assert!(me.memory_bytes > 0);
        assert!(
            me.project.is_some(),
            "project not populated (test binary should resolve via Cargo.toml)"
        );
        // On macOS, sysinfo reliably resolves a live process's own exe path
        // (this is the same process running the test), so assert it
        // unconditionally rather than guarding on `Some` — a guarded
        // `if let` here would be vacuous, since the codepath that
        // populates `executable_path` already filters out empty strings
        // before storing (see `.filter(|p| !p.as_os_str().is_empty())`
        // above), making `!exe.is_empty()` a tautology whenever it runs.
        let exe = me
            .executable_path
            .as_deref()
            .expect("executable_path should resolve for our own live test process on macOS");
        assert!(!exe.is_empty());
        drop(listener);
    }

    #[test]
    fn vanished_pid_still_yields_a_row() {
        let sys = System::new(); // deliberately not refreshed: knows no PIDs
        let users = Users::new_with_refreshed_list();
        let raw = RawPort {
            pid: 999_999,
            port: 4321,
            process_name: "ghost".into(),
        };
        let e = entry_for(raw, &sys, &users, 501, 1, Some("/Users/x"));
        assert_eq!(e.command, "ghost");
        assert_eq!(e.label, "ghost");
        assert_eq!(e.cwd, None);
        assert!(!e.killable);
        assert_eq!(e.started_at, 0);
        // Unresolvable PID: no owner UID known, so it classifies as system
        // and carries no path metadata.
        assert_eq!(e.category, super::super::classify::PortCategory::System);
        assert_eq!(e.executable_path, None);
        assert_eq!(e.app_bundle_path, None);
    }
}
