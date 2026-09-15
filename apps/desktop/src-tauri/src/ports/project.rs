use std::path::Path;

/// Spec §6: walk up from the cwd until `package.json`, `Cargo.toml` or
/// `.git`; prefer the `package.json` "name", else the folder name.
pub fn detect_project(cwd: &Path) -> Option<String> {
    for dir in cwd.ancestors() {
        let pkg = dir.join("package.json");
        if pkg.is_file() {
            return pkg_name(&pkg).or_else(|| dir_name(dir));
        }
        if dir.join("Cargo.toml").is_file() || dir.join(".git").exists() {
            return dir_name(dir);
        }
    }
    None
}

fn pkg_name(path: &Path) -> Option<String> {
    let text = std::fs::read_to_string(path).ok()?;
    let json: serde_json::Value = serde_json::from_str(&text).ok()?;
    Some(json.get("name")?.as_str()?.to_string())
}

fn dir_name(dir: &Path) -> Option<String> {
    Some(dir.file_name()?.to_string_lossy().into_owned())
}

/// `/Users/x/dev/app` → `~/dev/app`. Pure so it's testable; the caller
/// passes `std::env::var("HOME").ok()`.
pub fn tildify(path: &str, home: Option<&str>) -> String {
    match home {
        Some(h) if !h.is_empty() && path.starts_with(h) => format!("~{}", &path[h.len()..]),
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
        assert_eq!(detect_project(&deep), Some("laqi-panel".into()));
    }

    #[test]
    fn nearest_marker_wins_in_a_monorepo() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("mono");
        let app = root.join("apps/web");
        fs::create_dir_all(&app).unwrap();
        fs::write(root.join("package.json"), r#"{ "name": "mono-root" }"#).unwrap();
        fs::write(app.join("package.json"), r#"{ "name": "web-app" }"#).unwrap();
        assert_eq!(detect_project(&app), Some("web-app".into()));
    }

    #[test]
    fn package_json_without_name_falls_back_to_folder() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("thing");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("package.json"), r#"{ "private": true }"#).unwrap();
        assert_eq!(detect_project(&root), Some("thing".into()));
    }

    #[test]
    fn cargo_toml_uses_folder_name() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("rusty");
        let src = root.join("src");
        fs::create_dir_all(&src).unwrap();
        fs::write(root.join("Cargo.toml"), "[package]\nname = \"x\"\n").unwrap();
        assert_eq!(detect_project(&src), Some("rusty".into()));
    }

    #[test]
    fn git_dir_uses_folder_name() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("plain");
        fs::create_dir_all(root.join(".git")).unwrap();
        assert_eq!(detect_project(&root), Some("plain".into()));
    }

    #[test]
    fn no_marker_means_none() {
        let tmp = tempfile::tempdir().unwrap();
        assert_eq!(detect_project(tmp.path()), None);
    }

    #[test]
    fn tildify_replaces_home_prefix_only() {
        assert_eq!(tildify("/Users/c/dev/app", Some("/Users/c")), "~/dev/app");
        assert_eq!(tildify("/opt/homebrew", Some("/Users/c")), "/opt/homebrew");
        assert_eq!(tildify("/Users/c/dev", None), "/Users/c/dev");
        assert_eq!(tildify("/Users/c/dev", Some("")), "/Users/c/dev");
    }
}
