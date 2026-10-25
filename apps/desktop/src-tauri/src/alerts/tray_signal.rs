//! The tray signal: the existing door glyph, with a dot in the doorway while at least one alert
//! is firing. Both images are template images (black shapes plus alpha), so macOS recolours them
//! for light and dark menu bars. The glyph is not redesigned (owner decision 3).

use tauri::AppHandle;

use crate::TRAY_ID;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrayVariant {
    Normal,
    Alert,
}

/// The variant for the number of alerts firing.
pub fn tray_variant(firing: usize) -> TrayVariant {
    if firing == 0 {
        TrayVariant::Normal
    } else {
        TrayVariant::Alert
    }
}

#[cfg(target_os = "macos")]
fn icon_bytes(variant: TrayVariant) -> &'static [u8] {
    match variant {
        TrayVariant::Normal => include_bytes!("../../icons/tray-icon.png"),
        TrayVariant::Alert => include_bytes!("../../icons/tray-icon-alert.png"),
    }
}

/// Swaps the tray image. Does nothing off macOS (the bundle icon stays).
pub fn apply(app: &AppHandle, variant: TrayVariant) {
    #[cfg(target_os = "macos")]
    {
        let Some(tray) = app.tray_by_id(TRAY_ID) else {
            return;
        };
        match tauri::image::Image::from_bytes(icon_bytes(variant)) {
            Ok(icon) => {
                if let Err(e) = tray.set_icon(Some(icon)) {
                    log::warn!("alerts: could not swap the tray icon ({e})");
                    return;
                }
                let _ = tray.set_icon_as_template(true);
            }
            Err(e) => log::warn!("alerts: could not load the tray icon ({e})"),
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, variant, TRAY_ID);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_dot_shows_while_anything_is_firing() {
        assert_eq!(tray_variant(0), TrayVariant::Normal);
        assert_eq!(tray_variant(1), TrayVariant::Alert);
        assert_eq!(tray_variant(5), TrayVariant::Alert);
    }
}
