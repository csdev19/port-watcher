mod commands;
mod error;
mod panel;
mod ports;

use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

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
            TrayIconBuilder::with_id("chapay-tray")
                // Default icon until the design pass ships the template
                // image. Do NOT set icon_as_template(true) yet.
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("chapay")
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
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_ports,
            commands::kill_port
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
