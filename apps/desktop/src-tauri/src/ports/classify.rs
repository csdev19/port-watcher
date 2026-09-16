use std::path::{Path, PathBuf};

use serde::Serialize;

/// UX-facing classification of a listening process. This is a heuristic for
/// grouping and confirmation friction in the renderer — it is never a
/// backend permission boundary. All kill guards stay in `ports::kill`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PortCategory {
    Dev,
    App,
    System,
}

const SYSTEM_PREFIXES: [&str; 3] = ["/System", "/usr/libexec", "/usr/sbin"];

/// Classify a listening process from its owner UID and (if known) resolved
/// executable path. No filesystem access, no shell calls, no command-string
/// parsing — pure path/UID comparison only.
pub fn classify_port(
    owner_uid: Option<u32>,
    current_uid: u32,
    executable: Option<&Path>,
) -> PortCategory {
    match owner_uid {
        None => return PortCategory::System,
        Some(uid) if uid != current_uid => return PortCategory::System,
        _ => {}
    }

    if let Some(exe) = executable {
        if exe.is_absolute() && SYSTEM_PREFIXES.iter().any(|p| exe.starts_with(p)) {
            return PortCategory::System;
        }

        if app_bundle_path(exe).is_some() {
            return PortCategory::App;
        }
    }

    PortCategory::Dev
}

/// The outermost `.app` directory component in `executable`'s path, if any.
/// A bundle is a directory component ending in `.app`, not merely a final
/// filename that happens to end in `.app`.
pub fn app_bundle_path(executable: &Path) -> Option<PathBuf> {
    let mut acc = PathBuf::new();
    let mut components: Vec<_> = executable.components().collect();
    // Drop the final component (the executable filename itself) so a
    // filename like `foo.app` is never mistaken for a bundle directory.
    components.pop();

    for component in components {
        acc.push(component.as_os_str());
        if let Some(name) = component.as_os_str().to_str() {
            if name.ends_with(".app") {
                return Some(acc);
            }
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    const CURRENT_UID: u32 = 501;

    #[test]
    fn same_user_node_is_dev() {
        let exe = Path::new("/opt/homebrew/bin/node");
        assert_eq!(
            classify_port(Some(CURRENT_UID), CURRENT_UID, Some(exe)),
            PortCategory::Dev
        );
    }

    #[test]
    fn same_user_homebrew_postgres_is_dev() {
        let exe = Path::new("/opt/homebrew/Cellar/postgresql@16/16.4/bin/postgres");
        assert_eq!(
            classify_port(Some(CURRENT_UID), CURRENT_UID, Some(exe)),
            PortCategory::Dev
        );
    }

    #[test]
    fn other_user_executable_anywhere_is_system() {
        let exe = Path::new("/opt/homebrew/bin/node");
        assert_eq!(
            classify_port(Some(999), CURRENT_UID, Some(exe)),
            PortCategory::System
        );
    }

    #[test]
    fn unknown_owner_is_system() {
        let exe = Path::new("/opt/homebrew/bin/node");
        assert_eq!(
            classify_port(None, CURRENT_UID, Some(exe)),
            PortCategory::System
        );
    }

    #[test]
    fn same_user_control_center_inside_system_app_is_system() {
        // Precedence: system-prefix check wins over the `.app` bundle check.
        let exe = Path::new(
            "/System/Library/CoreServices/ControlCenter.app/Contents/MacOS/ControlCenter",
        );
        assert_eq!(
            classify_port(Some(CURRENT_UID), CURRENT_UID, Some(exe)),
            PortCategory::System
        );
    }

    #[test]
    fn rapportd_under_usr_libexec_is_system() {
        let exe = Path::new("/usr/libexec/rapportd");
        assert_eq!(
            classify_port(Some(CURRENT_UID), CURRENT_UID, Some(exe)),
            PortCategory::System
        );
    }

    #[test]
    fn usr_sbin_is_system() {
        let exe = Path::new("/usr/sbin/something");
        assert_eq!(
            classify_port(Some(CURRENT_UID), CURRENT_UID, Some(exe)),
            PortCategory::System
        );
    }

    #[test]
    fn systematic_prefix_is_not_system() {
        // `/Systematic` must not match the `/System` prefix boundary.
        let exe = Path::new("/Systematic/bin/thing");
        assert_eq!(
            classify_port(Some(CURRENT_UID), CURRENT_UID, Some(exe)),
            PortCategory::Dev
        );
    }

    #[test]
    fn discord_app_bundle_is_app() {
        let exe = Path::new("/Applications/Discord.app/Contents/MacOS/Discord");
        assert_eq!(
            classify_port(Some(CURRENT_UID), CURRENT_UID, Some(exe)),
            PortCategory::App
        );
    }

    #[test]
    fn missing_exe_same_uid_is_dev() {
        assert_eq!(
            classify_port(Some(CURRENT_UID), CURRENT_UID, None),
            PortCategory::Dev
        );
    }

    #[test]
    fn app_backup_suffix_is_not_a_dot_app_match() {
        // `foo.app-backup` does not end in `.app` at all, so it is not a
        // bundle-directory match by directory-component suffix.
        let exe = Path::new("/opt/homebrew/bin/foo.app-backup");
        assert_eq!(
            classify_port(Some(CURRENT_UID), CURRENT_UID, Some(exe)),
            PortCategory::Dev
        );
    }

    #[test]
    fn final_executable_filename_ending_in_dot_app_is_not_a_bundle() {
        // The executable's own filename ends in `.app` here (`foo.app` is
        // the final path component, not a directory it lives inside). That
        // must not be treated as being inside a `.app` bundle: bundle
        // detection only looks at directory *components*, and the final
        // component (the executable filename) is dropped before scanning.
        let exe = Path::new("/opt/homebrew/bin/foo.app");
        assert_eq!(app_bundle_path(exe), None);
        assert_eq!(
            classify_port(Some(CURRENT_UID), CURRENT_UID, Some(exe)),
            PortCategory::Dev
        );
    }

    #[test]
    fn nested_bundles_return_outermost_path() {
        let exe = Path::new("/Applications/Foo.app/Contents/Helpers/Bar.app/Contents/MacOS/Bar");
        assert_eq!(
            app_bundle_path(exe),
            Some(PathBuf::from("/Applications/Foo.app"))
        );
    }

    #[test]
    fn no_bundle_returns_none() {
        let exe = Path::new("/opt/homebrew/bin/node");
        assert_eq!(app_bundle_path(exe), None);
    }
}
