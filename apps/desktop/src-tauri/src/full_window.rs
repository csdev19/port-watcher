//! The full window (design 10b): a normal resizable window opened from the panel's ⤢ button.
//!
//! Built on demand and destroyed on close, so it costs nothing while closed. While it exists
//! chapay is a regular app (Dock icon, ⌘Tab entry); once it is gone the app goes back to
//! menu-bar-only. If focus or the menu bar misbehave in a build, delete the two
//! `set_activation_policy` calls and keep `Accessory` (the Settings window works that way).

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// Label of the full window; also its capability's window scope and the window-state denylist
/// complement (every other window is denied there).
pub const FULL_LABEL: &str = "full";

/// The activation policy chapay should have, given whether the full window exists.
#[cfg(target_os = "macos")]
pub fn activation_for(full_exists: bool) -> tauri::ActivationPolicy {
    if full_exists {
        tauri::ActivationPolicy::Regular
    } else {
        tauri::ActivationPolicy::Accessory
    }
}

#[cfg(target_os = "macos")]
fn apply_activation(app: &AppHandle, full_exists: bool) {
    if let Err(e) = app.set_activation_policy(activation_for(full_exists)) {
        log::warn!("full window: could not change the activation policy ({e})");
    }
}

/// Open the full window, or bring it to the front if it is open. Hides the panel.
pub fn open_full_window(app: &AppHandle) -> tauri::Result<()> {
    if let Some(panel) = app.get_webview_window("main") {
        let _ = panel.hide();
    }
    if let Some(window) = app.get_webview_window(FULL_LABEL) {
        window.unminimize()?;
        window.show()?;
        return window.set_focus();
    }

    let appearance = crate::appearance::stored_appearance(app);
    let theme = crate::appearance::effective_theme(app, appearance);
    let builder = WebviewWindowBuilder::new(
        app,
        FULL_LABEL,
        WebviewUrl::App("index.html?view=full".into()),
    )
    .title("chapay")
    .inner_size(980.0, 680.0)
    .min_inner_size(820.0, 560.0)
    .resizable(true)
    .center()
    .theme(crate::appearance::window_theme(appearance))
    .background_color(crate::appearance::background(theme));

    // The renderer draws its own title bar under the traffic lights.
    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);

    // Regular first, so the window can take focus as a normal app's window does.
    #[cfg(target_os = "macos")]
    apply_activation(app, true);

    let window = match builder.build() {
        Ok(w) => w,
        Err(e) => {
            #[cfg(target_os = "macos")]
            apply_activation(app, false);
            return Err(e);
        }
    };
    window.set_focus()
}

/// Close the full window and show the panel under the tray icon.
pub fn close_full_to_mini(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(FULL_LABEL) {
        // `destroy`, not `close`: the Destroyed event restores the Accessory policy.
        let _ = window.destroy();
    }
    crate::panel::toggle_panel(app);
}

/// Called for `WindowEvent::Destroyed` of the full window.
pub fn on_destroyed(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    apply_activation(app, false);
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;

    #[test]
    fn regular_only_while_the_window_exists() {
        assert!(matches!(
            activation_for(true),
            tauri::ActivationPolicy::Regular
        ));
        assert!(matches!(
            activation_for(false),
            tauri::ActivationPolicy::Accessory
        ));
    }
}
