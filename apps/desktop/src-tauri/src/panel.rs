use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_positioner::{Position, WindowExt};

use crate::{LastBlurHide, TrayRect, TRAY_ID};

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
    show_panel(app);
}

/// Shows the panel and never hides it: the entry point for a notification click. Same
/// placement and `panel-shown` event as the show branch of `toggle_panel`.
pub fn show_panel(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        log::warn!("show_panel: no window labeled 'main'");
        return;
    };
    if window.is_visible().unwrap_or(false) {
        return;
    }
    if !place_under_tray(app, &window) {
        // The tray icon's rect is unknown: no tray on this platform, or
        // AppKit has not laid the icon out yet.
        let _ = window.move_window(Position::TopRight);
    }
    show_and_focus(app, &window);
    let _ = app.emit("panel-shown", ());
}

#[cfg(target_os = "macos")]
tauri_nspanel::tauri_panel! {
    panel!(ChapayPanel {
        config: {
            can_become_key_window: true,
            is_floating_panel: true
        }
    })
}

/// Turn the panel window into a non-activating `NSPanel` that joins every
/// Space, including another app's full-screen Space.
///
/// A plain `NSWindow` cannot do this: even with `CanJoinAllSpaces` and
/// `FullScreenAuxiliary` set, macOS keeps it off a full-screen Space that
/// belongs to another app, so a tray click there showed nothing. A
/// non-activating panel also takes keyboard focus without activating
/// chapay, so showing it never switches the user to another Space.
///
/// Call once, from `setup`, before the panel is first shown.
#[cfg(target_os = "macos")]
pub fn convert_to_panel(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    use tauri_nspanel::{CollectionBehavior, PanelLevel, StyleMask, WebviewWindowExt};

    let panel = window.to_panel::<ChapayPanel>()?;
    if let Err(e) = panel.add_style_mask(StyleMask::empty().nonactivating_panel().value()) {
        log::warn!("panel: could not make it non-activating ({e:?}); showing it may switch Spaces");
    }
    panel.set_collection_behavior(
        CollectionBehavior::new()
            .can_join_all_spaces()
            .full_screen_auxiliary()
            .value(),
    );
    // Above full-screen windows, like the menu-bar extras it hangs from.
    panel.set_level(PanelLevel::Status.value());
    panel.set_hides_on_deactivate(false);
    Ok(())
}

#[cfg(target_os = "macos")]
fn show_and_focus(app: &AppHandle, window: &tauri::WebviewWindow) {
    use tauri_nspanel::ManagerExt;

    match app.get_webview_panel("main") {
        // Becomes key without activating chapay, so the user stays on the
        // current Space.
        Ok(panel) => panel.show_and_make_key(),
        Err(e) => {
            log::warn!("panel: not converted to an NSPanel ({e:?}); showing the plain window");
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn show_and_focus(_app: &AppHandle, window: &tauri::WebviewWindow) {
    let _ = window.show();
    let _ = window.set_focus();
}

/// A rectangle in logical points, top-left origin, in global screen space.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct LogicalRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl LogicalRect {
    fn contains(&self, x: f64, y: f64) -> bool {
        x >= self.x && x < self.x + self.width && y >= self.y && y < self.y + self.height
    }
}

/// A monitor's bounds in logical points plus its backing scale factor.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Screen {
    pub bounds: LogicalRect,
    pub scale: f64,
}

/// Where the panel's top-left corner goes, in logical points: centred
/// under the tray icon, top edge on the icon's bottom edge, kept inside
/// the icon's screen.
///
/// Every input arrives in *physical* pixels, but each in the scale of its
/// own screen: on a Retina laptop next to a 1x monitor, the same physical
/// number means two different places. So the tray rect is converted with
/// the scale of the screen it sits on, found by trying each screen's scale
/// and keeping the one whose bounds contain the result. Mixing scales was
/// what sent the panel to the wrong screen, or off every screen.
pub(crate) fn panel_origin(
    tray_physical: (f64, f64, f64, f64),
    panel_logical_width: f64,
    screens: &[Screen],
) -> Option<(f64, f64)> {
    let (px, py, pw, ph) = tray_physical;
    let (screen, tray) = screens.iter().find_map(|screen| {
        let tray = LogicalRect {
            x: px / screen.scale,
            y: py / screen.scale,
            width: pw / screen.scale,
            height: ph / screen.scale,
        };
        let centre_x = tray.x + tray.width / 2.0;
        let centre_y = tray.y + tray.height / 2.0;
        screen
            .bounds
            .contains(centre_x, centre_y)
            .then_some((screen, tray))
    })?;

    let wanted_x = tray.x + tray.width / 2.0 - panel_logical_width / 2.0;
    let min_x = screen.bounds.x;
    let max_x = screen.bounds.x + screen.bounds.width - panel_logical_width;
    Some((
        wanted_x.clamp(min_x, max_x.max(min_x)),
        tray.y + tray.height,
    ))
}

/// The tray icon's rect in physical pixels.
///
/// Asked from the icon itself, so ⌥⌘P places the panel correctly even
/// before the pointer has ever touched the icon; tray events only fill
/// the cached copy, which is the fallback.
fn tray_rect(app: &AppHandle) -> Option<(tauri::PhysicalPosition<f64>, tauri::PhysicalSize<f64>)> {
    let live = app
        .tray_by_id(TRAY_ID)
        .and_then(|tray| tray.rect().ok().flatten())
        .map(|rect| (rect.position.to_physical(1.0), rect.size.to_physical(1.0)));
    live.or_else(|| *app.try_state::<TrayRect>()?.0.lock().unwrap())
}

/// Move the panel under the tray icon. Returns false when the tray rect or
/// the screens are unknown, so the caller can fall back.
fn place_under_tray(app: &AppHandle, window: &tauri::WebviewWindow) -> bool {
    let Some((position, size)) = tray_rect(app) else {
        return false;
    };
    let Ok(monitors) = window.available_monitors() else {
        return false;
    };
    let screens: Vec<Screen> = monitors
        .iter()
        .map(|m| {
            let scale = m.scale_factor();
            Screen {
                bounds: LogicalRect {
                    x: f64::from(m.position().x) / scale,
                    y: f64::from(m.position().y) / scale,
                    width: f64::from(m.size().width) / scale,
                    height: f64::from(m.size().height) / scale,
                },
                scale,
            }
        })
        .collect();
    let panel_width = match (window.outer_size(), window.scale_factor()) {
        (Ok(size), Ok(scale)) => f64::from(size.width) / scale,
        _ => return false,
    };
    let tray = (position.x, position.y, size.width, size.height);
    let Some((x, y)) = panel_origin(tray, panel_width, &screens) else {
        log::warn!("panel: tray {tray:?} is on no known screen {screens:?}");
        return false;
    };
    log::debug!("panel: tray {tray:?} on {screens:?} -> origin ({x}, {y})");
    window
        .set_position(tauri::LogicalPosition::new(x, y))
        .is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    // The owner's setup: a 1x external monitor above-left, a 2x MacBook
    // screen below it (numbers from the panel logs, 2026-10-13).
    fn external() -> Screen {
        Screen {
            bounds: LogicalRect {
                x: 0.0,
                y: 0.0,
                width: 1920.0,
                height: 907.0,
            },
            scale: 1.0,
        }
    }
    fn laptop() -> Screen {
        Screen {
            bounds: LogicalRect {
                x: 0.0,
                y: 907.0,
                width: 1512.0,
                height: 982.0,
            },
            scale: 2.0,
        }
    }

    #[test]
    fn hangs_from_the_bottom_of_a_1x_tray_icon() {
        let (x, y) =
            panel_origin((1500.0, 0.0, 30.0, 30.0), 340.0, &[external(), laptop()]).unwrap();
        assert_eq!((x, y), (1515.0 - 170.0, 30.0));
    }

    #[test]
    fn converts_a_retina_tray_rect_with_its_own_scale() {
        // Physical y=1814 h=66 on the 2x screen is logical y=907 h=33.
        let (_, y) =
            panel_origin((2000.0, 1814.0, 66.0, 66.0), 340.0, &[external(), laptop()]).unwrap();
        assert_eq!(y, 940.0);
    }

    #[test]
    fn stays_inside_the_right_edge() {
        let (x, _) = panel_origin((1900.0, 0.0, 30.0, 30.0), 340.0, &[external()]).unwrap();
        assert_eq!(x, 1920.0 - 340.0);
    }

    #[test]
    fn handles_a_screen_above_the_primary_one() {
        let above = Screen {
            bounds: LogicalRect {
                x: 0.0,
                y: -1080.0,
                width: 1920.0,
                height: 1080.0,
            },
            scale: 1.0,
        };
        let (_, y) = panel_origin((100.0, -1080.0, 30.0, 30.0), 340.0, &[above]).unwrap();
        assert_eq!(y, -1050.0);
    }

    #[test]
    fn is_none_when_the_tray_is_on_no_screen() {
        assert!(panel_origin((5000.0, 5000.0, 30.0, 30.0), 340.0, &[external()]).is_none());
    }
}
