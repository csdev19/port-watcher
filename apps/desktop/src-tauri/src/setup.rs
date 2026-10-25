//! First-run setup window: a separate "setup" Tauri window that loads the
//! same renderer with `?view=setup`.

use std::fs;
use std::io;
use std::path::Path;
use std::process::Command;

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

pub const SETUP_LABEL: &str = "setup";

/// Marker file in the app config dir. It is written by Rust the moment the
/// window is first shown, so "shown once" does not depend on any renderer
/// state (localStorage is per-origin, so the dev and release builds would
/// disagree, and it can be cleared with the webview data).
const DONE_MARKER: &str = "setup-v1.done";

/// Deep link to Privacy & Security > Full Disk Access.
const FDA_SETTINGS_URL: &str =
    "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles";

/// True when the first-run window has never been shown.
pub fn is_first_run(config_dir: &Path) -> bool {
    !config_dir.join(DONE_MARKER).exists()
}

pub fn mark_done(config_dir: &Path) -> io::Result<()> {
    fs::create_dir_all(config_dir)?;
    fs::write(config_dir.join(DONE_MARKER), b"")
}

/// Shows the setup window, creating it on first use. Safe to call from the
/// tray menu repeatedly: an existing window is just brought to the front.
pub fn show_setup(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(SETUP_LABEL) {
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }
    let appearance = crate::appearance::stored_appearance(app);
    let theme = crate::appearance::effective_theme(app, appearance);
    let builder = WebviewWindowBuilder::new(
        app,
        SETUP_LABEL,
        WebviewUrl::App("index.html?view=setup".into()),
    )
    .title("")
    .inner_size(520.0, 720.0)
    .resizable(false)
    .decorations(true)
    .center()
    .theme(crate::appearance::window_theme(appearance))
    .background_color(crate::appearance::background(theme));
    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);
    match builder.build() {
        // The app is an Accessory app (no Dock icon), so a new window does
        // not come to front by itself; set_focus activates the app.
        Ok(window) => {
            let _ = window.show();
            let _ = window.set_focus();
        }
        Err(e) => log::error!("failed to open the setup window: {e}"),
    }
}

/// Opens System Settings at the Full Disk Access list.
pub fn open_fda_settings() -> io::Result<()> {
    Command::new("open")
        .arg(FDA_SETTINGS_URL)
        .spawn()
        .map(|_| ())
}

/// The Notifications pane of System Settings (unverified deep link on every macOS version;
/// `open_notification_settings` falls back to System Settings itself).
const NOTIFICATION_SETTINGS_URL: &str =
    "x-apple.systempreferences:com.apple.Notifications-Settings.extension";
const SYSTEM_SETTINGS_URL: &str = "x-apple.systempreferences:";

/// Opens System Settings at Notifications, or at its first page when the pane's link is refused.
pub fn open_notification_settings() -> io::Result<()> {
    for url in [NOTIFICATION_SETTINGS_URL, SYSTEM_SETTINGS_URL] {
        if Command::new("open")
            .arg(url)
            .status()
            .is_ok_and(|status| status.success())
        {
            return Ok(());
        }
    }
    Err(io::Error::other("could not open System Settings"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_run_until_marked_done() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("config");
        assert!(is_first_run(&dir));
        mark_done(&dir).unwrap();
        assert!(!is_first_run(&dir));
    }
}
