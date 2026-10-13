use tauri_plugin_global_shortcut::Shortcut;

/// The global shortcut that toggles the panel, in the plugin's string form.
/// "cmd" is the macOS Command key; other platforms use Control instead.
#[cfg(target_os = "macos")]
pub const TOGGLE_PANEL: &str = "alt+cmd+p";
#[cfg(not(target_os = "macos"))]
pub const TOGGLE_PANEL: &str = "alt+ctrl+p";

/// Whether a fired shortcut is the panel toggle.
///
/// Compares against the parsed `TOGGLE_PANEL` rather than spelling the
/// modifiers out again: the hand-written check used `Modifiers::META`
/// while "cmd" parses to `SUPER`, so it never matched.
pub fn is_toggle_panel(shortcut: &Shortcut) -> bool {
    TOGGLE_PANEL
        .parse::<Shortcut>()
        .is_ok_and(|toggle| *shortcut == toggle)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_registered_string_is_recognised_as_the_toggle() {
        let registered: Shortcut = TOGGLE_PANEL.parse().unwrap();
        assert!(is_toggle_panel(&registered));
    }

    #[test]
    fn another_shortcut_is_not_the_toggle() {
        let other: Shortcut = "alt+cmd+o".parse().unwrap();
        assert!(!is_toggle_panel(&other));
    }
}
