use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_positioner::{Position, WindowExt};

/// One toggle for every entry point (tray click, global shortcut).
/// Hide if visible; otherwise anchor under the tray icon, show, focus,
/// and tell the renderer so it can refetch and focus the search box.
pub fn toggle_panel(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        log::warn!("toggle_panel: no window labeled 'main'");
        return;
    };
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
        return;
    }
    // Requires tauri_plugin_positioner::on_tray_event to have been fed
    // tray events — wired in lib.rs — or the tray position is unknown.
    let _ = window.move_window(Position::TrayBottomCenter);
    let _ = window.show();
    let _ = window.set_focus();
    let _ = app.emit("panel-shown", ());
}
