use std::fs;
use std::io::Read;
use std::path::Path;

/// Largest `package.json` we are willing to read. Any local process can point
/// its cwd at an arbitrarily large file, which would stall port polling.
const MAX_PACKAGE_JSON_BYTES: u64 = 1024 * 1024;

/// Directories (relative to `$HOME`) that macOS protects with TCC. Touching
/// anything inside them makes the OS prompt the user, so we never probe there.
const PROTECTED_HOME_DIRS: [&str; 4] = [
    "Documents",
    "Desktop",
    "Downloads",
    "Library/Mobile Documents",
];

/// Spec §6: walk up from the cwd until `package.json`, `Cargo.toml` or
/// `.git`; prefer the `package.json` "name", else the folder name.
///
/// `home` is injected (the caller passes `$HOME`) so the logic stays testable.
/// The walk stops before `home` itself. Without Full Disk Access
/// (`protected_access == false`) a cwd under a TCC-protected
/// folder is named from its last path component without touching the disk;
/// with it, those folders are probed like any other.
pub fn detect_project(cwd: &Path, home: Option<&Path>, protected_access: bool) -> Option<String> {
    let home = home.filter(|h| !h.as_os_str().is_empty());
    if let Some(home) = home.filter(|_| !protected_access) {
        if PROTECTED_HOME_DIRS
            .iter()
            .any(|d| cwd.starts_with(home.join(d)))
        {
            return dir_name(cwd);
        }
    }
    for dir in cwd.ancestors() {
        if home.is_some_and(|h| dir == h) {
            break;
        }
        let pkg = dir.join("package.json");
        if is_regular_file(&pkg) {
            return pkg_name(&pkg).or_else(|| dir_name(dir));
        }
        if is_regular_file(&dir.join("Cargo.toml"))
            || fs::symlink_metadata(dir.join(".git")).is_ok()
        {
            return dir_name(dir);
        }
    }
    None
}

/// True for a regular file; symlinks are rejected without following them.
fn is_regular_file(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|m| m.file_type().is_file())
}

fn pkg_name(path: &Path) -> Option<String> {
    let file = fs::File::open(path).ok()?;
    if file.metadata().ok()?.len() > MAX_PACKAGE_JSON_BYTES {
        return None;
    }
    let mut text = String::new();
    file.take(MAX_PACKAGE_JSON_BYTES)
        .read_to_string(&mut text)
        .ok()?;
    let json: serde_json::Value = serde_json::from_str(&text).ok()?;
    Some(json.get("name")?.as_str()?.to_string())
}

fn dir_name(dir: &Path) -> Option<String> {
    Some(dir.file_name()?.to_string_lossy().into_owned())
}

/// `/Users/x/dev/app` → `~/dev/app`. Pure so it's testable; the caller
/// passes `std::env::var("HOME").ok()`. Only a whole-component match
/// counts: with HOME `/Users/c`, `/Users/cx` is left alone.
pub fn tildify(path: &str, home: Option<&str>) -> String {
    let Some(h) = home
        .map(|h| h.trim_end_matches('/'))
        .filter(|h| !h.is_empty())
    else {
        return path.to_string();
    };
    match path.strip_prefix(h) {
        Some(rest) if rest.is_empty() || rest.starts_with('/') => format!("~{rest}"),
        _ => path.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn package_json_name_wins() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("laqi");
        let deep = root.join("apps/web/src");
        fs::create_dir_all(&deep).unwrap();
        fs::write(root.join("package.json"), r#"{ "name": "laqi-panel" }"#).unwrap();
        assert_eq!(
            detect_project(&deep, None, false),
            Some("laqi-panel".into())
        );
    }

    #[test]
    fn nearest_marker_wins_in_a_monorepo() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("mono");
        let app = root.join("apps/web");
        fs::create_dir_all(&app).unwrap();
        fs::write(root.join("package.json"), r#"{ "name": "mono-root" }"#).unwrap();
        fs::write(app.join("package.json"), r#"{ "name": "web-app" }"#).unwrap();
        assert_eq!(detect_project(&app, None, false), Some("web-app".into()));
    }

    #[test]
    fn package_json_without_name_falls_back_to_folder() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("thing");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("package.json"), r#"{ "private": true }"#).unwrap();
        assert_eq!(detect_project(&root, None, false), Some("thing".into()));
    }

    #[test]
    fn cargo_toml_uses_folder_name() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("rusty");
        let src = root.join("src");
        fs::create_dir_all(&src).unwrap();
        fs::write(root.join("Cargo.toml"), "[package]\nname = \"x\"\n").unwrap();
        assert_eq!(detect_project(&src, None, false), Some("rusty".into()));
    }

    #[test]
    fn git_dir_uses_folder_name() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("plain");
        fs::create_dir_all(root.join(".git")).unwrap();
        assert_eq!(detect_project(&root, None, false), Some("plain".into()));
    }

    #[test]
    fn no_marker_means_none() {
        let tmp = tempfile::tempdir().unwrap();
        assert_eq!(detect_project(tmp.path(), None, false), None);
    }

    #[test]
    fn walk_stops_at_home() {
        let tmp = tempfile::tempdir().unwrap();
        let home = tmp.path().join("home");
        let cwd = home.join("scratch");
        fs::create_dir_all(&cwd).unwrap();
        // A marker in $HOME itself must not name the project.
        fs::write(home.join("package.json"), r#"{ "name": "dotfiles" }"#).unwrap();
        assert_eq!(detect_project(&cwd, Some(&home), false), None);
        assert_eq!(detect_project(&cwd, None, false), Some("dotfiles".into()));
    }

    #[test]
    fn protected_folders_are_named_without_probing() {
        let tmp = tempfile::tempdir().unwrap();
        let home = tmp.path().join("home");
        for protected in [
            "Documents",
            "Desktop",
            "Downloads",
            "Library/Mobile Documents",
        ] {
            let cwd = home.join(protected).join("proj/src");
            fs::create_dir_all(&cwd).unwrap();
            // The marker would name the project "real-name" if it were read.
            fs::write(
                home.join(protected).join("proj/package.json"),
                r#"{ "name": "real-name" }"#,
            )
            .unwrap();
            assert_eq!(detect_project(&cwd, Some(&home), false), Some("src".into()));
        }
    }

    #[test]
    fn protected_folders_are_probed_when_access_is_granted() {
        let tmp = tempfile::tempdir().unwrap();
        let home = tmp.path().join("home");
        for protected in [
            "Documents",
            "Desktop",
            "Downloads",
            "Library/Mobile Documents",
        ] {
            let cwd = home.join(protected).join("proj/src");
            fs::create_dir_all(&cwd).unwrap();
            fs::write(
                home.join(protected).join("proj/package.json"),
                r#"{ "name": "real-name" }"#,
            )
            .unwrap();
            assert_eq!(
                detect_project(&cwd, Some(&home), true),
                Some("real-name".into())
            );
        }
    }

    #[test]
    fn granted_access_still_stops_at_home() {
        let tmp = tempfile::tempdir().unwrap();
        let home = tmp.path().join("home");
        let cwd = home.join("Documents/scratch");
        fs::create_dir_all(&cwd).unwrap();
        fs::write(home.join("package.json"), r#"{ "name": "dotfiles" }"#).unwrap();
        assert_eq!(detect_project(&cwd, Some(&home), true), None);
    }

    #[test]
    fn unprotected_folder_under_home_is_still_probed() {
        let tmp = tempfile::tempdir().unwrap();
        let home = tmp.path().join("home");
        let cwd = home.join("dev/app/src");
        fs::create_dir_all(&cwd).unwrap();
        fs::write(home.join("dev/app/package.json"), r#"{ "name": "app" }"#).unwrap();
        assert_eq!(detect_project(&cwd, Some(&home), false), Some("app".into()));
    }

    #[test]
    fn oversized_package_json_falls_back_to_folder_name() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("big");
        fs::create_dir_all(&root).unwrap();
        let padding = " ".repeat(MAX_PACKAGE_JSON_BYTES as usize + 1);
        fs::write(
            root.join("package.json"),
            format!(r#"{{ "name": "huge"{padding} }}"#),
        )
        .unwrap();
        assert_eq!(detect_project(&root, None, false), Some("big".into()));
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_package_json_is_ignored() {
        let tmp = tempfile::tempdir().unwrap();
        let target = tmp.path().join("elsewhere.json");
        fs::write(&target, r#"{ "name": "linked" }"#).unwrap();
        let root = tmp.path().join("proj");
        fs::create_dir_all(&root).unwrap();
        std::os::unix::fs::symlink(&target, root.join("package.json")).unwrap();
        assert_eq!(detect_project(&root, None, false), None);
    }

    #[test]
    fn tildify_replaces_home_prefix_only() {
        assert_eq!(tildify("/Users/c/dev/app", Some("/Users/c")), "~/dev/app");
        assert_eq!(tildify("/opt/homebrew", Some("/Users/c")), "/opt/homebrew");
        assert_eq!(tildify("/Users/c/dev", None), "/Users/c/dev");
        assert_eq!(tildify("/Users/c/dev", Some("")), "/Users/c/dev");
    }

    #[test]
    fn tildify_respects_the_path_boundary() {
        assert_eq!(tildify("/Users/cx", Some("/Users/c")), "/Users/cx");
        assert_eq!(tildify("/Users/cx/dev", Some("/Users/c")), "/Users/cx/dev");
        assert_eq!(tildify("/Users/c", Some("/Users/c")), "~");
        assert_eq!(tildify("/Users/c/dev", Some("/Users/c/")), "~/dev");
        assert_eq!(tildify("/Users/c/dev", Some("/")), "/Users/c/dev");
    }
}
