//! "Check for updates": the app's only network call, made on click only.
//! There is no auto-updater; this just asks GitHub Releases whether a
//! newer desktop release exists. The CSP stays strict because the request
//! is made here, not from the webview.

use semver::Version;
use serde::{Deserialize, Serialize};

const RELEASES_URL: &str = "https://api.github.com/repos/csdev19/port-watcher/releases?per_page=20";
const TAG_PREFIX: &str = "desktop-v";

#[derive(Debug, Deserialize)]
pub struct Release {
    tag_name: String,
    html_url: String,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    prerelease: bool,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum UpdateCheck {
    Latest,
    Available { version: String, url: String },
}

/// Picks the newest published desktop release and compares it to `current`.
/// Drafts, prereleases, other apps' tags (`web-v*`) and unparsable tags are
/// ignored. Returns `None` when `current` is not valid semver.
pub fn evaluate(releases: &[Release], current: &str) -> Option<UpdateCheck> {
    let current = Version::parse(current).ok()?;
    let newest = releases
        .iter()
        .filter(|r| !r.draft && !r.prerelease)
        .filter_map(|r| {
            let v = Version::parse(r.tag_name.strip_prefix(TAG_PREFIX)?).ok()?;
            Some((v, r))
        })
        .max_by(|a, b| a.0.cmp(&b.0));
    Some(match newest {
        Some((v, r)) if v > current => UpdateCheck::Available {
            version: v.to_string(),
            url: r.html_url.clone(),
        },
        _ => UpdateCheck::Latest,
    })
}

pub fn check(current: &str) -> Result<UpdateCheck, String> {
    let releases: Vec<Release> = ureq::get(RELEASES_URL)
        .header("User-Agent", "chapay")
        .header("Accept", "application/vnd.github+json")
        .call()
        .map_err(|e| e.to_string())?
        .body_mut()
        .read_json()
        .map_err(|e| e.to_string())?;
    evaluate(&releases, current).ok_or_else(|| format!("invalid current version: {current}"))
}

/// Maps `std::env::consts::ARCH` to the label shown in About.
pub fn arch_label(arch: &str) -> String {
    match arch {
        "aarch64" => "Apple silicon".into(),
        "x86_64" => "Intel".into(),
        other => other.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rel(tag: &str, draft: bool, prerelease: bool) -> Release {
        Release {
            tag_name: tag.into(),
            html_url: format!("https://github.com/csdev19/port-watcher/releases/tag/{tag}"),
            draft,
            prerelease,
        }
    }

    fn available_version(r: &[Release], current: &str) -> String {
        match evaluate(r, current) {
            Some(UpdateCheck::Available { version, .. }) => version,
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn newer_release_is_available() {
        let r = [rel("desktop-v0.2.0", false, false)];
        assert_eq!(
            evaluate(&r, "0.1.0"),
            Some(UpdateCheck::Available {
                version: "0.2.0".into(),
                url: "https://github.com/csdev19/port-watcher/releases/tag/desktop-v0.2.0".into()
            })
        );
    }

    #[test]
    fn same_or_older_is_latest() {
        let r = [rel("desktop-v0.1.0", false, false)];
        assert_eq!(evaluate(&r, "0.1.0"), Some(UpdateCheck::Latest));
        assert_eq!(evaluate(&r, "0.3.0"), Some(UpdateCheck::Latest));
        assert_eq!(evaluate(&[], "0.1.0"), Some(UpdateCheck::Latest));
    }

    #[test]
    fn drafts_prereleases_and_other_apps_are_ignored() {
        let r = [
            rel("desktop-v9.0.0", true, false),
            rel("desktop-v8.0.0", false, true),
            rel("web-v7.0.0", false, false),
            rel("desktop-vbogus", false, false),
            rel("desktop-v0.1.1", false, false),
        ];
        assert_eq!(available_version(&r, "0.1.0"), "0.1.1");
    }

    #[test]
    fn orders_by_semver_not_list_position_or_string() {
        let r = [
            rel("desktop-v0.9.0", false, false),
            rel("desktop-v0.10.0", false, false),
            rel("desktop-v0.2.0", false, false),
        ];
        assert_eq!(available_version(&r, "0.1.0"), "0.10.0");
    }

    #[test]
    fn invalid_current_version_is_none() {
        assert_eq!(evaluate(&[], "nope"), None);
    }

    #[test]
    fn arch_labels() {
        assert_eq!(arch_label("aarch64"), "Apple silicon");
        assert_eq!(arch_label("x86_64"), "Intel");
        assert_eq!(arch_label("riscv64"), "riscv64");
    }
}
