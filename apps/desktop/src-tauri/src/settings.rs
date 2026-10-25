use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// Label of the Settings window; also the capability's window scope.
pub const SETTINGS_LABEL: &str = "settings";

/// Open the Settings window, or bring it to the front if it is open.
///
/// A normal window, not an NSPanel: Settings is a place the user goes to,
/// so it should activate chapay, take the keyboard and stay put on blur.
pub fn open_settings(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(SETTINGS_LABEL) {
        window.unminimize()?;
        window.show()?;
        return window.set_focus();
    }

    let appearance = crate::appearance::stored_appearance(app);
    let theme = crate::appearance::effective_theme(app, appearance);
    let builder = WebviewWindowBuilder::new(
        app,
        SETTINGS_LABEL,
        WebviewUrl::App("index.html?view=settings".into()),
    )
    // The renderer retitles the window after the selected section.
    .title("General")
    .inner_size(600.0, 540.0)
    .resizable(false)
    .maximizable(false)
    .center()
    .theme(crate::appearance::window_theme(appearance))
    .background_color(crate::appearance::background(theme));

    // Transparent title bar: the traffic lights and title sit on the
    // window's own background instead of the system's grey title bar.
    #[cfg(target_os = "macos")]
    let builder = builder.title_bar_style(tauri::TitleBarStyle::Transparent);

    let window = builder.build()?;
    window.set_focus()
}
