mod alerts;
mod appearance;
mod commands;
mod error;
mod fda;
mod health;
mod machine;
mod panel;
mod ports;
mod settings;
mod setup;
mod shortcut;
mod update;

use std::sync::Mutex;
use std::time::Instant;

use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::Manager;

/// Tracks the last time the panel was hidden by losing focus, so a tray
/// click landing immediately after (mouse-down blurs the window before
/// mouse-up reaches the tray handler) is treated as a dismiss, not a
/// reopen. See `toggle_panel` in src/panel.rs.
pub(crate) struct LastBlurHide(pub(crate) Mutex<Option<Instant>>);

/// The tray icon's id, used to look it up again from `toggle_panel`.
pub(crate) const TRAY_ID: &str = "chapay-tray";

/// The tray icon's last known rect in physical pixels, top-left origin.
/// `toggle_panel` hangs the panel from its bottom edge.
pub(crate) struct TrayRect(
    pub(crate) Mutex<Option<(tauri::PhysicalPosition<f64>, tauri::PhysicalSize<f64>)>>,
);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    // Must be registered before `setup` converts the panel window.
    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_nspanel::init());
    builder
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_positioner::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        // No window gets an `updater:*` permission: only the `update_*`
        // commands in src/update/ drive the updater (ADR 0007).
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            app.manage(LastBlurHide(Mutex::new(None)));
            app.manage(TrayRect(Mutex::new(None)));
            update::init(app.handle());
            // Click handler first (the plugin tracks only notifications shown after it exists),
            // then the engine, then the pressure subscriptions that feed it.
            alerts::notifier::init(app.handle());
            alerts::app::start(app.handle());
            health::init(app.handle());

            #[cfg(target_os = "macos")]
            if let Some(window) = app.get_webview_window("main") {
                if let Err(e) = panel::convert_to_panel(&window) {
                    log::error!("panel: NSPanel conversion failed ({e}); it will not open over full-screen apps");
                }
            }

            // Menu-bar app: no Dock icon, no ⌘Tab entry (spec §4.6).
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let settings_item = MenuItemBuilder::with_id("settings", "Settings…")
                .accelerator("CmdOrCtrl+,")
                .build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
            let tray_menu = MenuBuilder::new(app)
                .item(&settings_item)
                .separator()
                .item(&quit_item)
                .build()?;

            let mut tray = TrayIconBuilder::with_id(TRAY_ID);
            // macOS: a template image (black shapes + alpha only) lets the
            // OS recolor the tray icon for light/dark menu bars and the
            // selected/highlighted state. This is not a general-purpose
            // fallback icon — icon_as_template(true) would render wrong
            // (near-invisible or inverted) on platforms that don't apply
            // that convention.
            #[cfg(target_os = "macos")]
            {
                match tauri::image::Image::from_bytes(include_bytes!("../icons/tray-icon.png")) {
                    Ok(icon) => {
                        tray = tray.icon(icon).icon_as_template(true);
                    }
                    Err(e) => {
                        log::error!("failed to load tray template icon: {e}; falling back to the bundle icon");
                        if let Some(icon) = app.default_window_icon() {
                            tray = tray.icon(icon.clone());
                        }
                    }
                }
            }
            #[cfg(not(target_os = "macos"))]
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
                    match event.id.as_ref() {
                        "settings" => {
                            if let Err(e) = settings::open_settings(app) {
                                log::error!("settings: could not open the window ({e})");
                            }
                        }
                        "quit" => app.exit(0),
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    // Feed the positioner first — TrayBottomCenter is
                    // undefined without this.
                    tauri_plugin_positioner::on_tray_event(tray.app_handle(), &event);
                    if let TrayIconEvent::Click { rect, .. }
                    | TrayIconEvent::Enter { rect, .. }
                    | TrayIconEvent::Move { rect, .. }
                    | TrayIconEvent::Leave { rect, .. } = &event
                    {
                        if let Some(state) = tray.app_handle().try_state::<TrayRect>() {
                            *state.0.lock().unwrap() =
                                Some((rect.position.to_physical(1.0), rect.size.to_physical(1.0)));
                        }
                    }
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
                use tauri_plugin_global_shortcut::ShortcutState;

                let initial =
                    shortcut::startup_shortcut(shortcut::stored_shortcut(app.handle()).as_deref());
                app.manage(shortcut::ToggleShortcut(Mutex::new(initial)));
                let shortcut_plugin = tauri_plugin_global_shortcut::Builder::new()
                    .with_shortcuts([initial])?
                    .with_handler(|app, fired, event| {
                        log::debug!("shortcut: {fired:?} {:?}", event.state);
                        let is_toggle = app
                            .try_state::<shortcut::ToggleShortcut>()
                            .is_some_and(|s| {
                                shortcut::is_toggle_panel(&s.0.lock().unwrap(), fired)
                            });
                        if event.state == ShortcutState::Pressed && is_toggle {
                            crate::panel::toggle_panel(app);
                        }
                    })
                    .build();
                if let Err(e) = app.handle().plugin(shortcut_plugin) {
                    log::error!(
                        "global shortcut {initial:?} unavailable: {e}; use the tray icon instead"
                    );
                }
            }

            // First launch only: explain chapay and offer Full Disk Access.
            // The marker is written now, so the window never reopens by
            // itself; the tray menu item is the way back.
            match app.path().app_config_dir() {
                Ok(dir) if setup::is_first_run(&dir) => {
                    if let Err(e) = setup::mark_done(&dir) {
                        log::warn!("could not record first-run setup: {e}");
                    }
                    setup::show_setup(app.handle());
                }
                Ok(_) => {}
                Err(e) => log::warn!("no app config dir; skipping first-run setup: {e}"),
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            // A menu-bar panel dismisses itself when focus leaves it.
            // Note for development: opening the inspector steals focus and
            // closes the panel — use the browser dev loop for UI work.
            // Only the panel does this; the setup window must stay put.
            if window.label() != "main" {
                return;
            }
            if let tauri::WindowEvent::Focused(false) = event {
                if let Some(state) = window.try_state::<LastBlurHide>() {
                    *state.0.lock().unwrap() = Some(std::time::Instant::now());
                }
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_ports,
            commands::kill_port,
            commands::kill_process,
            commands::machine_snapshot,
            commands::top_processes,
            commands::check_full_disk_access,
            commands::open_full_disk_access_settings,
            commands::finish_setup,
            commands::show_setup_window,
            commands::app_arch,
            commands::update_status,
            commands::update_check,
            commands::update_install,
            commands::update_restart,
            commands::open_settings,
            commands::quit_app,
            commands::set_shortcut,
            commands::system_health_capabilities,
            commands::list_alert_rules,
            commands::set_alert_rule_enabled,
            commands::get_active_alerts
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
