//! In-app updates (ADR 0007). Rust owns the updater: the webview has no
//! `updater:*` permission and only calls the four `update_*` app commands.
//! The state lives here, so the panel banner and Settings › About always show
//! the same thing; every change is broadcast as `update-status`.
//!
//! Flow: check (feed request) → "available" → download (plugin verifies the
//! minisign signature and the signed version) → Developer ID gate
//! (`identity`) → install (plugin swaps the bundle) → "ready" → restart on
//! the user's click. Only the check ever runs by itself; nothing downloads or
//! installs without a click.
//!
//! A build without an updater endpoint (every local and dev build: the
//! release workflow injects the endpoint) reports `disabled` and never
//! touches the network.

pub mod identity;
pub mod policy;

use std::sync::Mutex;
use std::time::{Duration, SystemTime};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

use policy::FailureReason;

/// Broadcast to every window whenever the status changes.
pub const STATUS_EVENT: &str = "update-status";

/// Sent instead of the plugin's own `tauri-plugin-updater/<version>`.
const USER_AGENT: &str = "chapay";
const CHECK_TIMEOUT: Duration = Duration::from_secs(30);
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(5 * 60);

/// Let launch settle before the first automatic check.
const FIRST_AUTO_CHECK_DELAY: Duration = Duration::from_secs(10);
/// How often the automatic-check thread wakes to see whether a check is due.
const AUTO_CHECK_TICK: Duration = Duration::from_secs(30 * 60);

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum UpdateStatus {
    /// This build has no update endpoint (local and dev builds).
    Disabled,
    /// Nothing checked yet.
    Idle,
    Checking,
    UpToDate,
    Available {
        version: String,
    },
    Downloading {
        version: String,
        downloaded: u64,
        total: Option<u64>,
    },
    /// Installed on disk; the running process is still the old version.
    Ready {
        version: String,
    },
    /// Running from a translocated or read-only copy.
    CannotInstallHere {
        version: String,
    },
    CheckFailed {
        reason: FailureReason,
    },
    InstallFailed {
        version: String,
        reason: FailureReason,
    },
}

impl UpdateStatus {
    /// The automatic check only runs when there is no offer on screen and
    /// nothing in flight, so it never replaces what the user is looking at.
    pub fn allows_auto_check(&self) -> bool {
        matches!(self, Self::Idle | Self::UpToDate | Self::CheckFailed { .. })
    }

    /// A manual check can start from anything but an operation in flight or
    /// an update already installed.
    pub fn allows_check(&self) -> bool {
        !matches!(
            self,
            Self::Disabled | Self::Checking | Self::Downloading { .. } | Self::Ready { .. }
        )
    }

    /// The version an install would apply, if the status offers one.
    pub fn installable_version(&self) -> Option<&str> {
        match self {
            Self::Available { version }
            | Self::InstallFailed { version, .. }
            | Self::CannotInstallHere { version } => Some(version),
            _ => None,
        }
    }
}

struct Inner {
    status: UpdateStatus,
    pending: Option<Update>,
    last_check: Option<SystemTime>,
}

pub struct Updates(Mutex<Inner>);

fn lock(app: &AppHandle) -> std::sync::MutexGuard<'_, Inner> {
    app.state::<Updates>()
        .inner()
        .0
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn set_status(app: &AppHandle, status: UpdateStatus) -> UpdateStatus {
    lock(app).status = status.clone();
    if let Err(e) = app.emit(STATUS_EVENT, &status) {
        log::warn!("update: could not broadcast the status ({e})");
    }
    status
}

pub fn status(app: &AppHandle) -> UpdateStatus {
    lock(app).status.clone()
}

fn updater(app: &AppHandle) -> tauri_plugin_updater::Result<tauri_plugin_updater::Updater> {
    app.updater_builder()
        .version_comparator(|current, release| policy::is_update(&current, &release.version))
        .header("User-Agent", USER_AGENT)?
        .timeout(CHECK_TIMEOUT)
        .build()
}

/// Registers the state and, unless updates are off in this build or the
/// user turned the setting off, starts the automatic check.
pub fn init(app: &AppHandle) {
    let initial = match updater(app) {
        Ok(_) => UpdateStatus::Idle,
        Err(tauri_plugin_updater::Error::EmptyEndpoints) => {
            log::info!("update: no update endpoint in this build; updates are off");
            UpdateStatus::Disabled
        }
        Err(e) => {
            log::error!("update: the updater is misconfigured ({e}); updates are off");
            UpdateStatus::Disabled
        }
    };
    let disabled = initial == UpdateStatus::Disabled;
    app.manage(Updates(Mutex::new(Inner {
        status: initial,
        pending: None,
        last_check: None,
    })));
    // Debug builds never check by themselves, even with an endpoint.
    if disabled || cfg!(debug_assertions) {
        return;
    }
    let app = app.clone();
    let spawned = std::thread::Builder::new()
        .name("chapay-update-check".into())
        .spawn(move || {
            std::thread::sleep(FIRST_AUTO_CHECK_DELAY);
            loop {
                if auto_check_wanted(&app) {
                    tauri::async_runtime::block_on(check(&app));
                }
                std::thread::sleep(AUTO_CHECK_TICK);
            }
        });
    if let Err(e) = spawned {
        log::error!("update: could not start the automatic check ({e})");
    }
}

fn auto_check_wanted(app: &AppHandle) -> bool {
    use tauri_plugin_store::StoreExt;
    let enabled = app
        .store("settings.json")
        .map(|store| policy::auto_check_enabled(store.get("autoCheckUpdates").as_ref()))
        .unwrap_or(true);
    if !enabled {
        return false;
    }
    let inner = lock(app);
    inner.status.allows_auto_check() && policy::auto_check_due(inner.last_check, SystemTime::now())
}

/// Asks the feed whether a newer chapay exists.
pub async fn check(app: &AppHandle) -> UpdateStatus {
    {
        let mut inner = lock(app);
        if !inner.status.allows_check() {
            return inner.status.clone();
        }
        inner.last_check = Some(SystemTime::now());
        inner.pending = None;
    }
    set_status(app, UpdateStatus::Checking);

    let result = match updater(app) {
        Ok(updater) => updater.check().await,
        Err(e) => Err(e),
    };
    match result {
        Ok(Some(update)) if !policy::is_https(update.download_url.as_str()) => {
            log::error!(
                "update: the feed announced a non-HTTPS download ({}); ignoring it",
                update.download_url
            );
            set_status(
                app,
                UpdateStatus::CheckFailed {
                    reason: FailureReason::Other,
                },
            )
        }
        Ok(Some(update)) => {
            let version = update.version.clone();
            log::info!("update: chapay {version} is available");
            lock(app).pending = Some(update);
            set_status(app, UpdateStatus::Available { version })
        }
        Ok(None) => set_status(app, UpdateStatus::UpToDate),
        Err(e) => {
            log::warn!("update: check failed ({e})");
            set_status(
                app,
                UpdateStatus::CheckFailed {
                    reason: policy::classify(&e),
                },
            )
        }
    }
}

/// Where this copy of chapay runs from, if it can be replaced in place.
fn location_problem() -> Option<policy::LocationProblem> {
    let exe = std::env::current_exe().ok()?;
    let bundle = tauri_plugin_updater::extract_path_from_executable(&exe).ok()?;
    let read_only = nix::sys::statvfs::statvfs(&bundle)
        .map(|s| s.flags().contains(nix::sys::statvfs::FsFlags::ST_RDONLY))
        .unwrap_or(false);
    policy::install_location_problem(&bundle, read_only)
}

/// Downloads, verifies and installs the update found by the last check.
pub async fn install(app: &AppHandle) -> UpdateStatus {
    let (version, mut update) = {
        let inner = lock(app);
        match (inner.status.installable_version(), inner.pending.clone()) {
            (Some(version), Some(update)) => (version.to_string(), update),
            _ => return inner.status.clone(),
        }
    };
    if let Some(problem) = location_problem() {
        log::warn!("update: cannot install from this location ({problem:?})");
        return set_status(app, UpdateStatus::CannotInstallHere { version });
    }
    update.timeout = Some(DOWNLOAD_TIMEOUT);

    set_status(
        app,
        UpdateStatus::Downloading {
            version: version.clone(),
            downloaded: 0,
            total: None,
        },
    );
    let mut downloaded = 0u64;
    let mut reported = 0u64;
    let progress_app = app.clone();
    let progress_version = version.clone();
    let bytes = update
        .download(
            move |chunk, total| {
                downloaded += chunk as u64;
                if policy::progress_step_due(reported, downloaded, total) {
                    reported = downloaded;
                    set_status(
                        &progress_app,
                        UpdateStatus::Downloading {
                            version: progress_version.clone(),
                            downloaded,
                            total,
                        },
                    );
                }
            },
            || {},
        )
        .await;
    let failed = |reason| UpdateStatus::InstallFailed {
        version: version.clone(),
        reason,
    };
    let bytes = match bytes {
        Ok(bytes) => bytes,
        Err(e) => {
            log::error!("update: download or signature check failed ({e})");
            return set_status(app, failed(policy::classify(&e)));
        }
    };

    // Both steps block (unpacking, codesign, file moves, and possibly the
    // administrator prompt, which the plugin runs on the main thread), so
    // they run off the async runtime and off the main thread.
    let installed = tauri::async_runtime::spawn_blocking(move || {
        identity::check_update_archive(&bytes).map_err(|e| (FailureReason::DeveloperId, e))?;
        update
            .install(&bytes)
            .map_err(|e| (policy::classify(&e), e.to_string()))
    })
    .await;
    match installed {
        Ok(Ok(())) => {
            log::info!("update: chapay {version} installed; waiting for restart");
            lock(app).pending = None;
            set_status(app, UpdateStatus::Ready { version })
        }
        Ok(Err((reason, message))) => {
            log::error!("update: not installed ({reason:?}): {message}");
            set_status(app, failed(reason))
        }
        Err(e) => {
            log::error!("update: install task failed ({e})");
            set_status(app, failed(FailureReason::Other))
        }
    }
}

/// Relaunches into the installed version. Refuses unless one is installed.
pub fn restart(app: &AppHandle) -> Result<(), String> {
    if !matches!(status(app), UpdateStatus::Ready { .. }) {
        return Err("no update is installed".into());
    }
    app.restart()
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

    fn all() -> Vec<UpdateStatus> {
        let v = || "0.3.0".to_string();
        vec![
            UpdateStatus::Disabled,
            UpdateStatus::Idle,
            UpdateStatus::Checking,
            UpdateStatus::UpToDate,
            UpdateStatus::Available { version: v() },
            UpdateStatus::Downloading {
                version: v(),
                downloaded: 1,
                total: Some(2),
            },
            UpdateStatus::Ready { version: v() },
            UpdateStatus::CannotInstallHere { version: v() },
            UpdateStatus::CheckFailed {
                reason: FailureReason::Network,
            },
            UpdateStatus::InstallFailed {
                version: v(),
                reason: FailureReason::Signature,
            },
        ]
    }

    #[test]
    fn the_automatic_check_never_replaces_an_offer_or_interrupts_work() {
        let allowed: Vec<_> = all()
            .into_iter()
            .filter(UpdateStatus::allows_auto_check)
            .collect();
        assert_eq!(
            allowed,
            vec![
                UpdateStatus::Idle,
                UpdateStatus::UpToDate,
                UpdateStatus::CheckFailed {
                    reason: FailureReason::Network
                }
            ]
        );
    }

    #[test]
    fn a_manual_check_waits_for_work_in_flight_and_stops_once_installed() {
        for status in all() {
            let expected = !matches!(
                status,
                UpdateStatus::Disabled
                    | UpdateStatus::Checking
                    | UpdateStatus::Downloading { .. }
                    | UpdateStatus::Ready { .. }
            );
            assert_eq!(status.allows_check(), expected, "{status:?}");
        }
    }

    #[test]
    fn only_an_offered_or_retryable_update_can_be_installed() {
        let installable: Vec<_> = all()
            .iter()
            .filter_map(|s| s.installable_version().map(|_| s.clone()))
            .collect();
        assert_eq!(installable.len(), 3);
        assert!(installable.iter().all(|s| matches!(
            s,
            UpdateStatus::Available { .. }
                | UpdateStatus::InstallFailed { .. }
                | UpdateStatus::CannotInstallHere { .. }
        )));
    }

    #[test]
    fn status_serializes_for_the_renderer() {
        let json = serde_json::to_value(UpdateStatus::Downloading {
            version: "0.3.0".into(),
            downloaded: 10,
            total: None,
        })
        .unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "state": "downloading", "version": "0.3.0", "downloaded": 10, "total": null })
        );
        let json = serde_json::to_value(UpdateStatus::InstallFailed {
            version: "0.3.0".into(),
            reason: FailureReason::DeveloperId,
        })
        .unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "state": "installFailed", "version": "0.3.0", "reason": "developerId" })
        );
        assert_eq!(
            serde_json::to_value(UpdateStatus::CannotInstallHere {
                version: "1.0.0".into()
            })
            .unwrap()["state"],
            "cannotInstallHere"
        );
    }

    /// The feed the release workflow writes (scripts/updater-feed.sh, checked
    /// against the same fixture by its vitest) must parse as the plugin's
    /// release type and point each Mac at its own archive.
    #[test]
    fn the_release_feed_fixture_parses_as_a_plugin_release() {
        let feed: tauri_plugin_updater::RemoteRelease =
            serde_json::from_str(include_str!("../../../scripts/fixtures/latest.json")).unwrap();
        assert_eq!(feed.version.to_string(), "0.2.1");
        assert!(feed
            .download_url("darwin-aarch64")
            .unwrap()
            .as_str()
            .ends_with("/download/0.2.1/chapay-arm64.app.tar.gz"));
        assert!(feed
            .download_url("darwin-x86_64")
            .unwrap()
            .as_str()
            .ends_with("/download/0.2.1/chapay-x64.app.tar.gz"));
        assert!(policy::is_https(
            feed.download_url("darwin-aarch64").unwrap().as_str()
        ));
        assert_eq!(feed.signature("darwin-x86_64").unwrap(), "c2lnLXg2NA==");
    }

    /// The plugin parses this at startup, so a malformed block would stop
    /// chapay from launching. The committed config has no endpoint (local
    /// builds never update), demands a signed version, and never downgrades.
    #[test]
    fn the_committed_updater_config_is_safe() {
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../../tauri.conf.json")).unwrap();
        let updater = conf["plugins"]["updater"].clone();
        let config: tauri_plugin_updater::Config = serde_json::from_value(updater).unwrap();
        assert!(
            config.endpoints.is_empty(),
            "the release workflow injects it"
        );
        assert!(config.require_signed_version);
        assert!(!config.allow_downgrades);
        assert!(!config.dangerous_insecure_transport_protocol);
        assert!(!config.dangerous_accept_invalid_certs);
        assert!(!config.dangerous_accept_invalid_hostnames);
        assert!(!config.pubkey.is_empty());
        assert!(
            conf["bundle"].get("createUpdaterArtifacts").is_none(),
            "only the release job turns it on; local bundles have no key"
        );
    }

    #[test]
    fn arch_labels() {
        assert_eq!(arch_label("aarch64"), "Apple silicon");
        assert_eq!(arch_label("x86_64"), "Intel");
        assert_eq!(arch_label("riscv64"), "riscv64");
    }
}
