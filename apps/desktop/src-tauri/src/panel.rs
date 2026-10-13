use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_positioner::{Position, WindowExt};

use crate::LastBlurHide;

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
    // A tray click's mouse-down blurs the window (hiding it) before the
    // click handler runs on mouse-up — without this check, that hide
    // makes toggle_panel think the panel is closed and reopen it,
    // defeating the dismiss click entirely.
    if let Some(state) = app.try_state::<LastBlurHide>() {
        if let Some(last) = *state.0.lock().unwrap() {
            if last.elapsed() < Duration::from_millis(250) {
                return;
            }
        }
    }
    // Requires tauri_plugin_positioner::on_tray_event to have been fed
    // tray events — wired in lib.rs — or the tray position is unknown.
    // Constrained: a tray icon near the right edge would otherwise push
    // part of the 340 px panel off screen.
    if let Err(e) = window.move_window_constrained(Position::TrayBottomCenter) {
        log::debug!("tray position unknown yet ({e}); falling back to top-right");
        let _ = window.move_window(Position::TopRight);
    }
    let _ = window.show();
    let _ = window.set_focus();
    let _ = app.emit("panel-shown", ());
}

/// Let the panel open on whatever Space is active, including another
/// app's full-screen Space. A plain NSWindow belongs to the Space it was
/// created on, so without this the tray click shows the panel on the
/// desktop Space and the user sees nothing.
///
/// `CanJoinAllSpaces` puts the window on every Space; `FullScreenAuxiliary`
/// lets it appear over a full-screen app. Tauri's
/// `visible_on_all_workspaces` sets only the first.
///
/// AppKit requires the main thread: call this from `setup`.
#[cfg(target_os = "macos")]
pub fn join_all_spaces(window: &tauri::WebviewWindow) {
    use objc2_app_kit::{NSWindow, NSWindowCollectionBehavior};

    let ptr = match window.ns_window() {
        Ok(ptr) => ptr,
        Err(e) => {
            log::warn!("join_all_spaces: no NSWindow ({e}); the panel stays on one Space");
            return;
        }
    };
    // SAFETY: Tauri returns the window's live NSWindow, and `setup` runs
    // on the main thread, which AppKit requires for these calls.
    let ns_window: &NSWindow = unsafe { &*ptr.cast::<NSWindow>() };
    let behavior = ns_window.collectionBehavior()
        | NSWindowCollectionBehavior::CanJoinAllSpaces
        | NSWindowCollectionBehavior::FullScreenAuxiliary;
    ns_window.setCollectionBehavior(behavior);
}
