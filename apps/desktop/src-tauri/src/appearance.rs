//! The Appearance setting on the native side: which theme and background a
//! window gets when Rust creates it, so it opens in the right look from the
//! first frame (no dark flash in Light, no light flash in Dark).

use tauri::window::Color;
use tauri::{AppHandle, Manager, Theme};

/// Value of the `appearance` key in `settings.json`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Appearance {
    System,
    Dark,
    Light,
}

impl Appearance {
    /// Unknown or missing values mean `System`.
    fn parse(value: Option<&str>) -> Self {
        match value {
            Some("dark") => Self::Dark,
            Some("light") => Self::Light,
            _ => Self::System,
        }
    }
}

/// Reads the saved appearance from `settings.json`.
pub fn stored_appearance(app: &AppHandle) -> Appearance {
    use tauri_plugin_store::StoreExt;
    let saved = app
        .store("settings.json")
        .ok()
        .and_then(|store| store.get("appearance"));
    Appearance::parse(saved.as_ref().and_then(|v| v.as_str()))
}

/// The theme to force on a window, or `None` to follow macOS.
pub fn window_theme(appearance: Appearance) -> Option<Theme> {
    match appearance {
        Appearance::System => None,
        Appearance::Dark => Some(Theme::Dark),
        Appearance::Light => Some(Theme::Light),
    }
}

/// The theme a new window will actually show: the forced one, or macOS's
/// (read from the panel window; dark if it cannot be read).
pub fn effective_theme(app: &AppHandle, appearance: Appearance) -> Theme {
    window_theme(appearance).unwrap_or_else(|| {
        app.get_webview_window("main")
            .and_then(|w| w.theme().ok())
            .unwrap_or(Theme::Dark)
    })
}

/// Window background that matches `--pw-surface` in each theme.
pub fn background(theme: Theme) -> Color {
    match theme {
        Theme::Light => Color(0xff, 0xff, 0xff, 0xff),
        _ => Color(0x14, 0x10, 0x18, 0xff),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn window_theme_forces_only_dark_and_light() {
        assert_eq!(window_theme(Appearance::System), None);
        assert_eq!(window_theme(Appearance::Dark), Some(Theme::Dark));
        assert_eq!(window_theme(Appearance::Light), Some(Theme::Light));
    }

    #[test]
    fn parses_the_stored_value() {
        assert_eq!(Appearance::parse(Some("light")), Appearance::Light);
        assert_eq!(Appearance::parse(Some("dark")), Appearance::Dark);
        assert_eq!(Appearance::parse(Some("system")), Appearance::System);
        assert_eq!(Appearance::parse(Some("garbage")), Appearance::System);
        assert_eq!(Appearance::parse(None), Appearance::System);
    }

    #[test]
    fn background_matches_the_surface_token() {
        assert_eq!(background(Theme::Light), Color(255, 255, 255, 255));
        assert_eq!(background(Theme::Dark), Color(0x14, 0x10, 0x18, 255));
    }
}
