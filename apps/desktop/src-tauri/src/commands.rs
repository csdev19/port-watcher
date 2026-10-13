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

/// Swaps the global shortcut that toggles the panel. The renderer saves
/// the setting only after this succeeds, so a refused shortcut (another
/// app holds it) leaves both the old registration and the stored value.
#[tauri::command]
pub fn set_shortcut(app: tauri::AppHandle, shortcut: String) -> Result<(), AppError> {
    use crate::shortcut::{parse_shortcut, swap_shortcut, SwapError, ToggleShortcut};
    use tauri::Manager;
    use tauri_plugin_global_shortcut::GlobalShortcutExt;

    let next = parse_shortcut(&shortcut)?;
    let state = app.state::<ToggleShortcut>();
    let mut current = state
        .0
        .lock()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    if *current == next {
        return Ok(());
    }
    let gs = app.global_shortcut();
    swap_shortcut(&*current, &next, |s| gs.unregister(*s), |s| gs.register(*s)).map_err(
        |e| match e {
            SwapError::Unregister(err) | SwapError::Register(err) => {
                AppError::Shortcut(err.to_string())
            }
            SwapError::RollbackFailed { register, restore } => {
                log::error!("shortcut: could not restore the previous shortcut ({restore})");
                AppError::Shortcut(register.to_string())
            }
        },
    )?;
    *current = next;
    Ok(())
}
