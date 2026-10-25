use crate::error::AppError;
use crate::health::HealthState;
use crate::machine::dto::{MachineSnapshot, ProcessGroupDto};
use crate::ports::enrich::enrich;
use crate::ports::kill::{kill_port_impl, kill_process_impl};
use crate::ports::models::{KillResult, PortEntry};
use crate::ports::source::raw_ports;

/// Both the listeners scan and sysinfo refresh block; keep them off the
/// main thread so the tray/UI never stutters.
#[tauri::command]
pub async fn list_ports() -> Result<Vec<PortEntry>, AppError> {
    tauri::async_runtime::spawn_blocking(|| Ok(enrich(raw_ports()?)))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

/// Guard chain + SIGTERM/SIGKILL escalation; blocks up to ~2 s, so it runs
/// off the main thread like `list_ports`.
#[tauri::command]
pub async fn kill_port(pid: u32, port: u16, started_at: u64) -> Result<KillResult, AppError> {
    tauri::async_runtime::spawn_blocking(move || kill_port_impl(pid, port, started_at))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

/// One process, by PID plus start time, for the Machine tab's kill button. Same guard chain
/// and escalation as `kill_port` minus the port check (ADR 0006); blocks up to ~3 s.
#[tauri::command]
pub async fn kill_process(pid: u32, started_at: u64) -> Result<KillResult, AppError> {
    tauri::async_runtime::spawn_blocking(move || kill_process_impl(pid, started_at))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

/// Gauges, verdict and the last `window_s` seconds of history (default 60, at most 3600).
/// Takes a new sample only when the cached one is at least 900 ms old.
#[tauri::command]
pub async fn machine_snapshot(
    app: tauri::AppHandle,
    window_s: Option<u32>,
) -> Result<MachineSnapshot, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        use tauri::Manager;
        let snapshot = app.state::<HealthState>().machine_snapshot(window_s);
        // The alert rules see every panel sample, so they never sample a second time.
        crate::alerts::app::forward_readings(&app);
        snapshot
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?
}

/// Top processes by CPU, grouped by app bundle (default 5, at most 20). Walks every process
/// once, so the renderer polls it only while the Machine tab is open.
#[tauri::command]
pub async fn top_processes(
    app: tauri::AppHandle,
    limit: Option<u8>,
) -> Result<Vec<ProcessGroupDto>, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        use tauri::Manager;
        app.state::<HealthState>().top_processes(limit)
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?
}

/// Probes Full Disk Access right now (no prompt is ever triggered) and
/// refreshes the cache that port enrichment reads.
#[tauri::command]
pub async fn check_full_disk_access() -> Result<bool, AppError> {
    tauri::async_runtime::spawn_blocking(crate::fda::check_now)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))
}

/// Opens System Settings at Privacy & Security > Full Disk Access.
#[tauri::command]
pub fn open_full_disk_access_settings() -> Result<(), AppError> {
    crate::setup::open_fda_settings().map_err(|e| AppError::Internal(e.to_string()))
}

/// Opens System Settings at Notifications. chapay cannot read whether macOS lets it post, so
/// Settings › Permissions only links there.
#[tauri::command]
pub fn open_notification_settings() -> Result<(), AppError> {
    crate::setup::open_notification_settings().map_err(|e| AppError::Internal(e.to_string()))
}

/// "Open chapay" on the final setup screen: close the setup window, then
/// open the panel through the same toggle the tray and shortcut use.
#[tauri::command]
pub fn finish_setup(app: tauri::AppHandle) {
    use tauri::Manager;
    if let Some(window) = app.get_webview_window(crate::setup::SETUP_LABEL) {
        let _ = window.destroy();
    }
    crate::panel::toggle_panel(&app);
}

/// "Show the first-run window again" in Settings › Permissions. The setup
/// window is created if needed and focused, so it lands in front of Settings.
#[tauri::command]
pub fn show_setup_window(app: tauri::AppHandle) {
    crate::setup::show_setup(&app);
}

/// CPU architecture label for About: "Apple silicon", "Intel", or the raw value.
#[tauri::command]
pub fn app_arch() -> String {
    crate::update::arch_label(std::env::consts::ARCH)
}

/// The updater's current state, for a window that just opened.
#[tauri::command]
pub fn update_status(app: tauri::AppHandle) -> crate::update::UpdateStatus {
    crate::update::status(&app)
}

/// Asks the update feed whether a newer chapay exists ("Check for updates").
#[tauri::command]
pub async fn update_check(app: tauri::AppHandle) -> crate::update::UpdateStatus {
    crate::update::check(&app).await
}

/// Downloads, verifies and installs the update the last check found. Only
/// ever called from a click ("Update" in the banner or About).
#[tauri::command]
pub async fn update_install(app: tauri::AppHandle) -> crate::update::UpdateStatus {
    crate::update::install(&app).await
}

/// Relaunches into the installed update ("Restart chapay").
#[tauri::command]
pub fn update_restart(app: tauri::AppHandle) -> Result<(), AppError> {
    crate::update::restart(&app).map_err(AppError::Internal)
}

/// Swaps the global shortcut that toggles the panel. The renderer saves
/// the setting only after this succeeds, so a refused shortcut (another
/// app holds it) leaves both the old registration and the stored value.
#[tauri::command]
pub fn set_shortcut(app: tauri::AppHandle, shortcut: String) -> Result<(), AppError> {
    use crate::shortcut::{parse_shortcut, swap_shortcut, SwapError, ToggleShortcut};
    use tauri::Manager;
    use tauri_plugin_global_shortcut::GlobalShortcutExt;

    let next = parse_shortcut(&shortcut)?;
    let state = app.state::<ToggleShortcut>();
    let mut current = state
        .0
        .lock()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    if *current == next {
        return Ok(());
    }
    let gs = app.global_shortcut();
    swap_shortcut(&*current, &next, |s| gs.unregister(*s), |s| gs.register(*s)).map_err(
        |e| match e {
            SwapError::Unregister(err) | SwapError::Register(err) => {
                AppError::Shortcut(err.to_string())
            }
            SwapError::RollbackFailed { register, restore } => {
                log::error!("shortcut: could not restore the previous shortcut ({restore})");
                AppError::Shortcut(register.to_string())
            }
        },
    )?;
    *current = next;
    Ok(())
}

/// Opens Settings from the panel's gear button or ⌘, (the tray menu calls
/// `settings::open_settings` directly).
#[tauri::command]
pub fn open_settings(app: tauri::AppHandle) -> Result<(), AppError> {
    crate::settings::open_settings(&app).map_err(|e| AppError::Internal(e.to_string()))
}

/// What this Mac can report to the System health context (read-only; Phase 3 shows it).
#[tauri::command]
pub fn system_health_capabilities(
    state: tauri::State<'_, crate::health::HealthState>,
) -> system_health::Capabilities {
    state.capabilities()
}

/// The panel footer's Quit, same effect as the tray menu's Quit item.
#[tauri::command]
pub fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

/// The fixed alert rules with their switches and whether each is firing now.
#[tauri::command]
pub fn list_alert_rules(app: tauri::AppHandle) -> Vec<crate::alerts::AlertRule> {
    crate::alerts::app::list_rules(&app)
}

/// Turns a rule on or off in the engine. The renderer saves the setting only after this
/// succeeds (apply-then-save, like `set_shortcut`).
#[tauri::command]
pub fn set_alert_rule_enabled(
    app: tauri::AppHandle,
    rule: crate::alerts::AlertRuleId,
    enabled: bool,
) -> Result<(), AppError> {
    crate::alerts::app::set_rule_enabled(&app, rule, enabled)
}

/// What is firing right now, for a window that just opened.
#[tauri::command]
pub fn get_active_alerts(app: tauri::AppHandle) -> Vec<crate::alerts::ActiveAlert> {
    crate::alerts::app::active_alerts(&app)
}
