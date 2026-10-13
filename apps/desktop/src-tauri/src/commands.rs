use crate::error::AppError;
use crate::ports::enrich::enrich;
use crate::ports::kill::kill_port_impl;
use crate::ports::models::{KillResult, PortEntry};
use crate::ports::source::raw_ports;

/// Both the listeners scan and sysinfo refresh block; keep them off the
/// main thread so the tray/UI never stutters.
#[tauri::command]
pub async fn list_ports() -> Result<Vec<PortEntry>, AppError> {
    tauri::async_runtime::spawn_blocking(|| Ok(enrich(raw_ports()?)))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

/// Guard chain + SIGTERM/SIGKILL escalation; blocks up to ~2 s, so it runs
/// off the main thread like `list_ports`.
#[tauri::command]
pub async fn kill_port(pid: u32, port: u16, started_at: u64) -> Result<KillResult, AppError> {
    tauri::async_runtime::spawn_blocking(move || kill_port_impl(pid, port, started_at))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

/// Probes Full Disk Access right now (no prompt is ever triggered) and
/// refreshes the cache that port enrichment reads.
#[tauri::command]
pub async fn check_full_disk_access() -> Result<bool, AppError> {
    tauri::async_runtime::spawn_blocking(crate::fda::check_now)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))
}

/// Opens System Settings at Privacy & Security > Full Disk Access.
#[tauri::command]
pub fn open_full_disk_access_settings() -> Result<(), AppError> {
    crate::setup::open_fda_settings().map_err(|e| AppError::Internal(e.to_string()))
}

/// "Open chapay" on the final setup screen: close the setup window, then
/// open the panel through the same toggle the tray and shortcut use.
#[tauri::command]
pub fn finish_setup(app: tauri::AppHandle) {
    use tauri::Manager;
    if let Some(window) = app.get_webview_window(crate::setup::SETUP_LABEL) {
        let _ = window.destroy();
    }
    crate::panel::toggle_panel(&app);
}

/// "Show the first-run window again" in Settings › Permissions. The setup
/// window is created if needed and focused, so it lands in front of Settings.
#[tauri::command]
pub fn show_setup_window(app: tauri::AppHandle) {
    crate::setup::show_setup(&app);
}

/// CPU architecture label for About: "Apple silicon", "Intel", or the raw value.
#[tauri::command]
pub fn app_arch() -> String {
    crate::update::arch_label(std::env::consts::ARCH)
}

/// Asks GitHub Releases whether a newer desktop release exists. Called on
/// click only; it is the app's one network request.
#[tauri::command]
pub async fn check_for_update(current: String) -> Result<crate::update::UpdateCheck, AppError> {
    tauri::async_runtime::spawn_blocking(move || crate::update::check(&current))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
        .map_err(AppError::Internal)
}
