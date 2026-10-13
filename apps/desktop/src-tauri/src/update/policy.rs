//! The updater's pure decisions: which release counts as an update, when the
//! automatic check is due, where an update cannot be installed, and how a
//! failure is reported. Nothing here touches the network or the disk.

use std::path::Path;
use std::time::{Duration, SystemTime};

use semver::Version;
use serde::Serialize;

/// The automatic check runs once after launch, then at most this often.
pub const AUTO_CHECK_INTERVAL: Duration = Duration::from_secs(24 * 60 * 60);

/// Report download progress about every this many bytes (a release is ~2 MB).
pub const PROGRESS_STEP_BYTES: u64 = 64 * 1024;

/// The comparator handed to the plugin, which makes its `allowDowngrades`
/// flag irrelevant: only a strictly newer, plain `X.Y.Z` release counts.
/// chapay has no pre-release channel, so a pre-release or build-tagged
/// version in the feed is never offered.
pub fn is_update(current: &Version, offered: &Version) -> bool {
    offered.pre.is_empty() && offered.build.is_empty() && offered > current
}

/// Whether the automatic check should run now. It runs on the first tick
/// after launch, then once `AUTO_CHECK_INTERVAL` has passed since the last
/// check (manual checks count). Wall-clock time, so a Mac that slept through
/// the night still checks in the morning; a clock moved backwards checks once
/// and starts counting again from there.
pub fn auto_check_due(last_check: Option<SystemTime>, now: SystemTime) -> bool {
    match last_check {
        None => true,
        Some(last) => match now.duration_since(last) {
            Ok(elapsed) => elapsed >= AUTO_CHECK_INTERVAL,
            Err(_) => true,
        },
    }
}

/// Reads the `autoCheckUpdates` setting from `settings.json`. On by default:
/// only an explicit `false` turns it off.
pub fn auto_check_enabled(stored: Option<&serde_json::Value>) -> bool {
    !matches!(stored, Some(serde_json::Value::Bool(false)))
}

/// Why chapay cannot replace itself where it is running from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LocationProblem {
    /// macOS runs a quarantined app from a randomised read-only copy
    /// (App Translocation) until the user moves it.
    Translocated,
    /// Running straight from the mounted DMG or another read-only volume.
    ReadOnlyVolume,
}

/// Whether the bundle at `bundle` can be swapped in place.
/// `volume_read_only` comes from `statvfs` on the bundle's volume.
pub fn install_location_problem(bundle: &Path, volume_read_only: bool) -> Option<LocationProblem> {
    if bundle
        .components()
        .any(|c| c.as_os_str() == "AppTranslocation")
    {
        return Some(LocationProblem::Translocated);
    }
    if volume_read_only {
        return Some(LocationProblem::ReadOnlyVolume);
    }
    None
}

/// The plugin enforces HTTPS for the feed endpoint in release builds, but not
/// for the archive URL the feed announces. chapay refuses anything else.
pub fn is_https(url: &str) -> bool {
    url.get(..8)
        .is_some_and(|scheme| scheme.eq_ignore_ascii_case("https://"))
}

/// Whether enough new bytes arrived to report progress again.
pub fn progress_step_due(last_reported: u64, downloaded: u64, total: Option<u64>) -> bool {
    downloaded.saturating_sub(last_reported) >= PROGRESS_STEP_BYTES
        || total.is_some_and(|t| downloaded >= t && last_reported < t)
}

/// What the UI says about a failure; the raw message goes to the log.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FailureReason {
    /// The feed or the archive could not be fetched.
    Network,
    /// The archive does not match the updater signature or the signed version.
    Signature,
    /// The extracted app is not signed by chapay's Developer ID.
    DeveloperId,
    /// The user dismissed the administrator prompt.
    Cancelled,
    /// The feed or the install path is not what chapay expects.
    Other,
}

/// Maps the plugin's error to what the UI shows.
pub fn classify(error: &tauri_plugin_updater::Error) -> FailureReason {
    use tauri_plugin_updater::Error as E;
    match error {
        E::Reqwest(_) | E::Network(_) => FailureReason::Network,
        E::Minisign(_)
        | E::Base64(_)
        | E::SignatureUtf8(_)
        | E::SignedVersionMismatch { .. }
        | E::MissingSignedVersion => FailureReason::Signature,
        E::AuthenticationFailed => FailureReason::Cancelled,
        _ => FailureReason::Other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn v(s: &str) -> Version {
        Version::parse(s).unwrap()
    }

    #[test]
    fn only_a_strictly_newer_release_is_an_update() {
        assert!(is_update(&v("0.2.0"), &v("0.2.1")));
        assert!(is_update(&v("0.2.0"), &v("0.10.0")));
        assert!(!is_update(&v("0.2.0"), &v("0.2.0")));
        assert!(!is_update(&v("0.2.0"), &v("0.1.9")), "downgrade refused");
        assert!(!is_update(&v("1.0.0"), &v("0.9.9")), "downgrade refused");
    }

    #[test]
    fn pre_releases_and_build_tags_are_never_offered() {
        assert!(!is_update(&v("0.2.0"), &v("0.3.0-beta.1")));
        assert!(!is_update(&v("0.2.0"), &v("0.3.0+build.5")));
    }

    #[test]
    fn auto_check_runs_first_then_daily() {
        let t0 = SystemTime::UNIX_EPOCH + Duration::from_secs(1_800_000_000);
        assert!(auto_check_due(None, t0));
        assert!(!auto_check_due(Some(t0), t0));
        assert!(!auto_check_due(
            Some(t0),
            t0 + AUTO_CHECK_INTERVAL - Duration::from_secs(1)
        ));
        assert!(auto_check_due(Some(t0), t0 + AUTO_CHECK_INTERVAL));
        assert!(auto_check_due(Some(t0), t0 + AUTO_CHECK_INTERVAL * 3));
    }

    #[test]
    fn a_clock_moved_backwards_makes_the_check_due() {
        let t0 = SystemTime::UNIX_EPOCH + Duration::from_secs(1_800_000_000);
        assert!(auto_check_due(Some(t0), t0 - Duration::from_secs(60)));
    }

    #[test]
    fn auto_check_is_on_unless_explicitly_off() {
        use serde_json::json;
        assert!(auto_check_enabled(None));
        assert!(auto_check_enabled(Some(&json!(true))));
        assert!(
            auto_check_enabled(Some(&json!("false"))),
            "junk keeps the default"
        );
        assert!(!auto_check_enabled(Some(&json!(false))));
    }

    #[test]
    fn translocated_and_read_only_copies_cannot_update() {
        let translocated =
            PathBuf::from("/private/var/folders/x/T/AppTranslocation/1A2B/d/chapay.app");
        assert_eq!(
            install_location_problem(&translocated, true),
            Some(LocationProblem::Translocated)
        );
        assert_eq!(
            install_location_problem(Path::new("/Volumes/chapay/chapay.app"), true),
            Some(LocationProblem::ReadOnlyVolume)
        );
        assert_eq!(
            install_location_problem(Path::new("/Applications/chapay.app"), false),
            None
        );
    }

    #[test]
    fn only_https_urls_are_accepted() {
        assert!(is_https(
            "https://pub-x.r2.dev/download/0.2.1/chapay-arm64.app.tar.gz"
        ));
        assert!(is_https("HTTPS://example.com/a"));
        assert!(!is_https("http://example.com/a"));
        assert!(!is_https("file:///tmp/a"));
        assert!(!is_https("https:/"));
    }

    #[test]
    fn progress_is_reported_in_steps_and_at_the_end() {
        assert!(!progress_step_due(0, 1024, Some(2_000_000)));
        assert!(progress_step_due(0, PROGRESS_STEP_BYTES, Some(2_000_000)));
        assert!(progress_step_due(1_990_000, 2_000_000, Some(2_000_000)));
        assert!(!progress_step_due(2_000_000, 2_000_000, Some(2_000_000)));
        assert!(!progress_step_due(0, 1024, None));
    }

    #[test]
    fn plugin_errors_map_to_what_the_ui_says() {
        use tauri_plugin_updater::Error as E;
        assert_eq!(classify(&E::Network("503".into())), FailureReason::Network);
        assert_eq!(classify(&E::MissingSignedVersion), FailureReason::Signature);
        assert_eq!(
            classify(&E::SignedVersionMismatch {
                signed: "0.2.0".into(),
                announced: "0.3.0".into()
            }),
            FailureReason::Signature
        );
        assert_eq!(classify(&E::AuthenticationFailed), FailureReason::Cancelled);
        assert_eq!(classify(&E::ReleaseNotFound), FailureReason::Other);
    }
}
