use std::sync::Mutex;

use tauri_plugin_global_shortcut::Shortcut;

use crate::error::AppError;

/// The platform default for the panel toggle, in the plugin's string form.
/// Used when the `shortcut` setting is missing or does not parse.
/// "cmd" is the macOS Command key; other platforms use Control instead.
#[cfg(target_os = "macos")]
pub const TOGGLE_PANEL: &str = "alt+cmd+p";
#[cfg(not(target_os = "macos"))]
pub const TOGGLE_PANEL: &str = "alt+ctrl+p";

/// The shortcut that currently toggles the panel. Lives in managed state
/// so `set_shortcut` can swap it while the app runs.
pub struct ToggleShortcut(pub Mutex<Shortcut>);

/// Parses a shortcut string and refuses one without a modifier: a bare
/// key would hijack typing in every app.
pub fn parse_shortcut(raw: &str) -> Result<Shortcut, AppError> {
    let shortcut: Shortcut = raw
        .parse()
        .map_err(|e| AppError::Shortcut(format!("{raw:?} is not a valid shortcut: {e}")))?;
    if shortcut.mods.is_empty() {
        return Err(AppError::Shortcut(
            "a shortcut needs at least one modifier".into(),
        ));
    }
    Ok(shortcut)
}

/// The shortcut to register at startup: the stored one when it parses,
/// else the platform default.
pub fn startup_shortcut(stored: Option<&str>) -> Shortcut {
    stored
        .and_then(|raw| parse_shortcut(raw).ok())
        .unwrap_or_else(default_shortcut)
}

fn default_shortcut() -> Shortcut {
    TOGGLE_PANEL
        .parse()
        .expect("the platform default shortcut parses")
}

/// Whether a fired shortcut is the panel toggle. Compares parsed values
/// rather than spelling modifiers out: "cmd" parses to `SUPER`, not `META`.
pub fn is_toggle_panel(current: &Shortcut, fired: &Shortcut) -> bool {
    current == fired
}

/// How a swap failed.
#[derive(Debug, PartialEq)]
pub enum SwapError<E> {
    /// Unregistering the old shortcut failed; the old one is still active.
    Unregister(E),
    /// The new shortcut was refused; the old one was registered again.
    Register(E),
    /// The new shortcut was refused and the old one could not be restored.
    RollbackFailed { register: E, restore: E },
}

/// Replaces `old` by `new`: unregister the old, register the new, and put
/// the old one back if the new one is refused (another app holds it).
pub fn swap_shortcut<S, E>(
    old: &S,
    new: &S,
    mut unregister: impl FnMut(&S) -> Result<(), E>,
    mut register: impl FnMut(&S) -> Result<(), E>,
) -> Result<(), SwapError<E>> {
    unregister(old).map_err(SwapError::Unregister)?;
    match register(new) {
        Ok(()) => Ok(()),
        Err(register_err) => match register(old) {
            Ok(()) => Err(SwapError::Register(register_err)),
            Err(restore) => Err(SwapError::RollbackFailed {
                register: register_err,
                restore,
            }),
        },
    }
}

/// Reads the saved shortcut string from `settings.json`, if any.
pub fn stored_shortcut(app: &tauri::AppHandle) -> Option<String> {
    use tauri_plugin_store::StoreExt;
    let store = app.store("settings.json").ok()?;
    store.get("shortcut")?.as_str().map(str::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_registered_string_is_recognised_as_the_toggle() {
        let registered: Shortcut = TOGGLE_PANEL.parse().unwrap();
        assert!(is_toggle_panel(&registered, &registered));
    }

    #[test]
    fn another_shortcut_is_not_the_toggle() {
        let current: Shortcut = TOGGLE_PANEL.parse().unwrap();
        let other: Shortcut = "alt+cmd+o".parse().unwrap();
        assert!(!is_toggle_panel(&current, &other));
    }

    #[test]
    fn parse_accepts_a_modified_key() {
        assert!(parse_shortcut("alt+cmd+k").is_ok());
    }

    #[test]
    fn parse_refuses_a_bare_key() {
        assert!(parse_shortcut("k").is_err());
    }

    #[test]
    fn parse_refuses_garbage() {
        assert!(parse_shortcut("alt+cmd+nonsense").is_err());
    }

    #[test]
    fn startup_uses_the_stored_shortcut() {
        let expected: Shortcut = "alt+cmd+k".parse().unwrap();
        assert_eq!(startup_shortcut(Some("alt+cmd+k")), expected);
    }

    #[test]
    fn startup_falls_back_when_missing_unparseable_or_unmodified() {
        let default = default_shortcut();
        assert_eq!(startup_shortcut(None), default);
        assert_eq!(startup_shortcut(Some("???")), default);
        assert_eq!(startup_shortcut(Some("k")), default);
    }

    #[test]
    fn swap_registers_the_new_shortcut() {
        let calls = std::cell::RefCell::new(vec![]);
        let result = swap_shortcut(
            &"old",
            &"new",
            |s| {
                calls.borrow_mut().push(format!("unregister {s}"));
                Ok::<(), &str>(())
            },
            |s| {
                calls.borrow_mut().push(format!("register {s}"));
                Ok(())
            },
        );
        assert_eq!(result, Ok(()));
        assert_eq!(*calls.borrow(), ["unregister old", "register new"]);
    }

    #[test]
    fn swap_restores_the_old_shortcut_when_the_new_is_refused() {
        let mut registered = vec![];
        let result = swap_shortcut(
            &"old",
            &"new",
            |_| Ok(()),
            |s| {
                if *s == "new" {
                    return Err("taken");
                }
                registered.push(*s);
                Ok(())
            },
        );
        assert_eq!(result, Err(SwapError::Register("taken")));
        assert_eq!(registered, ["old"]);
    }

    #[test]
    fn swap_leaves_everything_alone_when_unregister_fails() {
        let mut registered = 0;
        let result = swap_shortcut(
            &"old",
            &"new",
            |_| Err("busy"),
            |_| {
                registered += 1;
                Ok(())
            },
        );
        assert_eq!(result, Err(SwapError::Unregister("busy")));
        assert_eq!(registered, 0);
    }

    #[test]
    fn swap_reports_when_the_old_shortcut_cannot_be_restored() {
        let result = swap_shortcut(&"old", &"new", |_| Ok(()), |_| Err("no"));
        assert_eq!(
            result,
            Err(SwapError::RollbackFailed {
                register: "no",
                restore: "no"
            })
        );
    }
}
