mod commands;
mod error;
mod panel;
mod ports;

use std::sync::Mutex;
use std::time::Instant;

use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::Manager;

/// Tracks the last time the panel was hidden by losing focus, so a tray
/// click landing immediately after (mouse-down blurs the window before
/// mouse-up reaches the tray handler) is treated as a dismiss, not a
/// reopen. See docs/superpowers/plans/2026-09-15-chapay-menubar-shell.md.
pub(crate) struct LastBlurHide(pub(crate) Mutex<Option<Instant>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_positioner::init())
        .setup(|app| {
            app.manage(LastBlurHide(Mutex::new(None)));

            // Menu-bar app: no Dock icon, no ⌘Tab entry (spec §4.6).
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            // The panel's frosted-glass look previously relied solely on
            // CSS `backdrop-filter` inside a `transparent: true` WKWebView
            // window. That combination is unreliable on macOS: the
            // captured backdrop can be invalidated by any compositor
            // recomposite (e.g. a mouse-move repaint), leaving only the
            // panel's low-alpha background color with no blur — the panel
            // reads as "gone see-through". Native vibrancy is applied at
            // the NSWindow/compositor level instead, so it survives
            // repaints; the CSS blur remains as a secondary refinement.
            #[cfg(target_os = "macos")]
            if let Some(window) = app.get_webview_window("main") {
                if let Err(e) = window_vibrancy::apply_vibrancy(
                    &window,
                    window_vibrancy::NSVisualEffectMaterial::HudWindow,
                    Some(window_vibrancy::NSVisualEffectState::Active),
                    None,
                ) {
                    log::warn!("native panel vibrancy unavailable: {e}; falling back to CSS backdrop-filter only");
                }
            }

            let quit_item = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
            let tray_menu = MenuBuilder::new(app).item(&quit_item).build()?;

            let mut tray = TrayIconBuilder::with_id("chapay-tray");
            // Default icon until the design pass ships the template
            // image. Do NOT set icon_as_template(true) yet.
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            } else {
                log::warn!(
                    "no default window icon available; tray icon will use the OS placeholder"
                );
            }
            tray.menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| {
                    if event.id.as_ref() == "quit" {
                        app.exit(0);
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    // Feed the positioner first — TrayBottomCenter is
                    // undefined without this.
                    tauri_plugin_positioner::on_tray_event(tray.app_handle(), &event);
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        panel::toggle_panel(tray.app_handle());
                    }
                })
                .build(app)?;

            {
                use tauri_plugin_global_shortcut::{Code, Modifiers, ShortcutState};

                let shortcut_plugin = tauri_plugin_global_shortcut::Builder::new()
                    .with_shortcuts(["alt+cmd+p"])?
                    .with_handler(|app, shortcut, event| {
                        if event.state == ShortcutState::Pressed
                            && shortcut.matches(Modifiers::ALT | Modifiers::META, Code::KeyP)
                        {
                            crate::panel::toggle_panel(app);
                        }
                    })
                    .build();
                if let Err(e) = app.handle().plugin(shortcut_plugin) {
                    log::error!(
                        "global shortcut alt+cmd+p unavailable: {e}; use the tray icon instead"
                    );
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            // A menu-bar panel dismisses itself when focus leaves it.
            // Note for development: opening the inspector steals focus and
            // closes the panel — use the browser dev loop for UI work.
            if let tauri::WindowEvent::Focused(false) = event {
                if let Some(state) = window.try_state::<LastBlurHide>() {
                    *state.0.lock().unwrap() = Some(std::time::Instant::now());
                }
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_ports,
            commands::kill_port
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
