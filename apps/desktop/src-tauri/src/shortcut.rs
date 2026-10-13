use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut};

/// The global shortcut that toggles the panel, in the plugin's string form.
pub const TOGGLE_PANEL: &str = "alt+cmd+p";

/// Whether a fired shortcut is the panel toggle.
///
/// "cmd" parses to `Modifiers::SUPER`, not `META`: `matches` drops `META`
/// before comparing, so a `META` check never matches and the shortcut
/// silently did nothing.
pub fn is_toggle_panel(shortcut: &Shortcut) -> bool {
    shortcut.matches(Modifiers::ALT | Modifiers::SUPER, Code::KeyP)
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
