use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

/// Label of the Settings window; also the capability's window scope.
pub const SETTINGS_LABEL: &str = "settings";

/// Sections the Settings window can open on. Mirrors `SettingsSection` in
/// src/lib/ports.ts and the toolbar in src/settings/Settings.tsx.
const SECTIONS: [&str; 5] = ["general", "ports", "thermal", "permissions", "about"];

/// Sent to an already open Settings window to switch its section; the
/// payload is a section id from `SECTIONS`.
const SECTION_EVENT: &str = "settings-section";

/// The section id when `id` names a known section. Only these reach the
/// window URL or the switch event.
pub fn known_section(id: &str) -> Option<&'static str> {
    SECTIONS.iter().copied().find(|s| *s == id)
}

/// Open the Settings window, or bring it to the front if it is open, on
/// `section` when given (else wherever it opens or already is).
///
/// A normal window, not an NSPanel: Settings is a place the user goes to,
/// so it should activate chapay, take the keyboard and stay put on blur.
pub fn open_settings(app: &AppHandle, section: Option<&'static str>) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(SETTINGS_LABEL) {
        // An event, not a navigation: the window keeps its state and does
        // not flash while it reloads.
        if let Some(section) = section {
            app.emit_to(SETTINGS_LABEL, SECTION_EVENT, section)?;
        }
        window.unminimize()?;
        window.show()?;
        return window.set_focus();
    }

    let url = match section {
        Some(section) => format!("index.html?view=settings&section={section}"),
        None => "index.html?view=settings".to_owned(),
    };
    let builder = WebviewWindowBuilder::new(app, SETTINGS_LABEL, WebviewUrl::App(url.into()))
        // The renderer retitles the window after the selected section.
        .title("General")
        .inner_size(600.0, 540.0)
        .resizable(false)
        .maximizable(false)
        .center()
        .theme(Some(tauri::Theme::Dark))
        .background_color(tauri::window::Color(0x14, 0x10, 0x18, 0xff));

    // Transparent title bar: the traffic lights and title sit on the
    // window's own #141018 instead of the system's grey title bar.
    #[cfg(target_os = "macos")]
    let builder = builder.title_bar_style(tauri::TitleBarStyle::Transparent);

    let window = builder.build()?;
    window.set_focus()
}

#[cfg(test)]
mod tests {
    use super::known_section;

    #[test]
    fn accepts_every_settings_section() {
        for id in ["general", "ports", "thermal", "permissions", "about"] {
            assert_eq!(known_section(id), Some(id));
        }
    }

    #[test]
    fn rejects_anything_else() {
        for id in ["", "Thermal", "thermal&x=1", "../thermal", "updates"] {
            assert_eq!(known_section(id), None);
        }
    }
}
