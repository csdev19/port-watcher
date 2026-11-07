use crate::error::AppError;
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

/// Kill for a row that is not chosen through a port (the Memory tab). Same
/// guard chain and escalation as `kill_port` minus the port check; Rust
/// re-derives the policy, whatever `killable` the renderer saw.
#[tauri::command]
pub async fn kill_process(pid: u32, started_at: u64) -> Result<KillResult, AppError> {
    tauri::async_runtime::spawn_blocking(move || kill_process_impl(pid, started_at))
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

/// Opens Settings from the panel: the gear button and ⌘, with no section,
/// the Thermal tab's footer link on `thermal` (the tray menu calls
/// `settings::open_settings` directly). An unknown section is refused.
#[tauri::command]
pub fn open_settings(app: tauri::AppHandle, section: Option<String>) -> Result<(), AppError> {
    let section = section
        .map(|id| {
            crate::settings::known_section(&id)
                .ok_or_else(|| AppError::Internal(format!("unknown settings section: {id}")))
        })
        .transpose()?;
    crate::settings::open_settings(&app, section).map_err(|e| AppError::Internal(e.to_string()))
}

/// A fresh sensor read (not the database), plus the 7-day baseline when
/// history exists. `None` when the Mac exposes no usable die sensor.
#[tauri::command]
pub async fn thermal_current(
    app: tauri::AppHandle,
) -> Result<Option<crate::thermal::api::ThermalReadingDto>, AppError> {
    use crate::thermal::api::ThermalReadingDto;
    use crate::thermal::sampler::{read_reading, Thermal};
    use tauri::Manager;

    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Thermal>();
        let reading = {
            let mut sensors = state.sensors.lock().unwrap_or_else(|e| e.into_inner());
            read_reading(&mut sensors, chrono::Utc::now().timestamp())
        };
        let Some(reading) = reading else {
            return Ok(None);
        };
        let baseline = state
            .store
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
            .and_then(|store| {
                let since = crate::thermal::sampler::window_start_day(reading.at_s, 7);
                store.baseline(&since).ok().flatten()
            });
        Ok(Some(ThermalReadingDto::new(&reading, baseline)))
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?
}

/// Buckets and peaks in `[from_s, to_s)` plus the last `days` daily
/// summaries. `available` is false when the store did not open.
#[tauri::command]
pub async fn thermal_history(
    app: tauri::AppHandle,
    from_s: i64,
    to_s: i64,
    days: i64,
) -> Result<crate::thermal::api::ThermalHistoryDto, AppError> {
    use crate::thermal::api::ThermalHistoryDto;
    use crate::thermal::sampler::Thermal;
    use tauri::Manager;

    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Thermal>();
        let guard = state.store.lock().unwrap_or_else(|e| e.into_inner());
        let Some(store) = guard.as_ref() else {
            return Ok(ThermalHistoryDto::unavailable());
        };
        let internal = |e: crate::thermal::store::StoreError| AppError::Internal(e.to_string());
        Ok(ThermalHistoryDto {
            available: true,
            buckets: store
                .buckets(from_s, to_s)
                .map_err(internal)?
                .into_iter()
                .map(Into::into)
                .collect(),
            peaks: store
                .peaks(from_s, to_s)
                .map_err(internal)?
                .into_iter()
                .map(Into::into)
                .collect(),
            days: store
                .days(&crate::thermal::sampler::window_start_day(
                    chrono::Utc::now().timestamp(),
                    days,
                ))
                .map_err(internal)?,
        })
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?
}

/// A fresh memory read (not the database): system figures, the verdict and
/// the top processes with their ports and, for rows chapay may not kill, the
/// Terminal command. Reads even while the guard is off (spec: the tab still
/// reads the current state while open). `None` when the system figures
/// cannot be read.
#[tauri::command]
pub async fn memory_current(
    app: tauri::AppHandle,
) -> Result<Option<crate::memory::api::MemoryReading>, AppError> {
    use crate::memory::api::{build_reading, observe_all, RowContext};
    use crate::memory::procs::ProcessReader;
    use crate::memory::verdict::evaluate;
    use crate::thermal::sampler::Thermal;
    use std::collections::HashMap;
    use tauri::Manager;

    tauri::async_runtime::spawn_blocking(move || {
        let now = chrono::Utc::now().timestamp();
        // The tab is open and the user is looking: refresh `top` if the last
        // run is a minute old (never more often, from any path).
        let top = crate::memory::topcmd::snapshot(now, true);
        let Some((obs, all)) = observe_all(&mut ProcessReader::new(), now, &top) else {
            return Ok(None);
        };
        let keys: Vec<(u32, u64)> = obs.procs.iter().map(|p| (p.pid, p.started_at)).collect();
        let first = {
            let state = app.state::<Thermal>();
            let guard = state.store.lock().unwrap_or_else(|e| e.into_inner());
            match guard.as_ref().map(|s| s.memory_first_samples(&keys)) {
                Some(Ok(first)) => first,
                Some(Err(e)) => {
                    log::error!("memory: could not read first samples ({e})");
                    HashMap::new()
                }
                None => HashMap::new(),
            }
        };
        let thresholds = crate::memory::sampler::load_thresholds(&app);
        let eval = evaluate(&obs.system, &obs.procs, &thresholds, &first);

        let mut ports: HashMap<u32, Vec<u16>> = HashMap::new();
        match raw_ports() {
            Ok(list) => {
                for p in list {
                    ports.entry(p.pid).or_default().push(p.port);
                }
            }
            Err(e) => log::warn!("memory: could not list ports ({e})"),
        }
        let daemons = crate::memory::launchd::scan_daemons(std::path::Path::new(
            crate::memory::launchd::DAEMONS_DIR,
        ));
        let user_name = |uid: u32| {
            nix::unistd::User::from_uid(nix::unistd::Uid::from_raw(uid))
                .ok()
                .flatten()
                .map(|u| u.name)
        };
        let ctx = RowContext {
            my_uid: nix::unistd::Uid::effective().as_raw(),
            self_pid: std::process::id(),
            ports: &ports,
            daemons: &daemons,
            user_name: &user_name,
        };
        Ok(Some(build_reading(&obs, &all, &eval, &first, &ctx)))
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?
}

/// Memory buckets in `[from_s, to_s)` plus the last `days` daily summaries.
/// `available` is false when the store did not open.
#[tauri::command]
pub async fn memory_history(
    app: tauri::AppHandle,
    from_s: i64,
    to_s: i64,
    days: i64,
) -> Result<crate::memory::api::MemoryHistory, AppError> {
    use crate::memory::api::MemoryHistory;
    use crate::thermal::sampler::Thermal;
    use tauri::Manager;

    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Thermal>();
        let guard = state.store.lock().unwrap_or_else(|e| e.into_inner());
        let Some(store) = guard.as_ref() else {
            return Ok(MemoryHistory::unavailable());
        };
        let internal = |e: crate::thermal::store::StoreError| AppError::Internal(e.to_string());
        Ok(MemoryHistory {
            available: true,
            buckets: store
                .memory_buckets(from_s, to_s)
                .map_err(internal)?
                .into_iter()
                .map(Into::into)
                .collect(),
            days: store
                .memory_days(&crate::thermal::sampler::window_start_day(
                    chrono::Utc::now().timestamp(),
                    days,
                ))
                .map_err(internal)?
                .into_iter()
                .map(Into::into)
                .collect(),
        })
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?
}

/// The thresholds the verdict uses: the stored ones, or the defaults.
#[tauri::command]
pub fn memory_thresholds(app: tauri::AppHandle) -> crate::memory::verdict::MemoryThresholds {
    crate::memory::sampler::load_thresholds(&app)
}

/// Saves the thresholds in `settings.json`. Invalid numbers are refused, so
/// the sampler never reads a value `memory_thresholds` would discard.
/// Invoked with `{ thresholds }`.
#[tauri::command]
pub fn set_memory_thresholds(
    app: tauri::AppHandle,
    thresholds: crate::memory::verdict::MemoryThresholds,
) -> Result<(), AppError> {
    if !thresholds.is_valid() {
        return Err(AppError::Internal(
            "memory thresholds: percentages must be in (0, 100] and the growth factor above 1"
                .into(),
        ));
    }
    crate::memory::sampler::save_thresholds(&app, &thresholds).map_err(AppError::Internal)
}
