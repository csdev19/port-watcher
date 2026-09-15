# chapay Menu-Bar Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the plain window into a menu-bar panel: tray icon that toggles it, panel positioned under the icon, no Dock presence, hide-on-blur, and the ⌥⌘P global shortcut.

**Architecture:** All in Rust — a `panel.rs` module owns one `toggle_panel(app)` function shared by the tray click handler and the global shortcut. Window chrome comes from `tauri.conf.json` (undecorated, always-on-top, starts hidden). This is OS-behavior code: the test cycle per task is `cargo check` + a scripted manual verification, stated explicitly.

**Tech Stack:** Tauri 2 (`tray-icon` feature), `tauri-plugin-positioner` 2 (`tray-icon` feature), `tauri-plugin-global-shortcut` 2.

**Spec:** `docs/specs/2026-09-15-chapay-mvp-spec.md`

## Global Constraints

- Everything committed is English.
- Event contract (the renderer listens for it): emit `"panel-shown"` on every show, from every path (tray click and shortcut).
- macOS-only behaviors (`ActivationPolicy::Accessory`) go behind `#[cfg(target_os = "macos")]` — the code must still compile for other targets even though v0.1 ships macOS only.
- The tray icon stays the Tauri default for now — the branded template image comes with the design pass. Do not set `icon_as_template(true)` until that asset exists (the default icon is not a template image and would render as a black blob).
- This plan can be executed before or after the renderer plan; only the `"panel-shown"` listener behavior needs the renderer in place to observe.

---

### Task 1: Window chrome + plugin dependencies

**Files:**

- Modify: `apps/desktop/src-tauri/Cargo.toml`
- Modify: `apps/desktop/src-tauri/tauri.conf.json`

**Interfaces:**

- Consumes: nothing.
- Produces: a hidden, undecorated, fixed-size, always-on-top window labeled `main`; the `tray-icon` feature and both plugins available to Task 2+.

- [ ] **Step 1: Enable the feature and add plugins**

In `apps/desktop/src-tauri/Cargo.toml`, change the tauri dependency line to:

```toml
tauri = { version = "2", features = ["tray-icon"] }
```

and add:

```toml
tauri-plugin-positioner = { version = "2", features = ["tray-icon"] }
tauri-plugin-global-shortcut = "2"
```

- [ ] **Step 2: Window config**

In `apps/desktop/src-tauri/tauri.conf.json`, replace the `app.windows[0]` object with:

```json
{
  "title": "chapay — port watcher",
  "label": "main",
  "width": 360,
  "height": 480,
  "resizable": false,
  "decorations": false,
  "alwaysOnTop": true,
  "visible": false,
  "skipTaskbar": true
}
```

`visible: false` — the app starts as a silent tray resident; nothing appears until the tray or the shortcut asks.

- [ ] **Step 3: Verify**

Run: `cd apps/desktop/src-tauri && cargo check`
Expected: clean (new crates compile).

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src-tauri/Cargo.toml apps/desktop/src-tauri/Cargo.lock apps/desktop/src-tauri/tauri.conf.json
git commit -m "feat(desktop-shell): hidden undecorated panel window and tray plugins"
```

---

### Task 2: Tray icon + toggle + positioning

**Files:**

- Create: `apps/desktop/src-tauri/src/panel.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`

**Interfaces:**

- Consumes: window label `main` (Task 1).
- Produces: `pub fn toggle_panel(app: &AppHandle)` — hide if visible; else position under the tray, show, focus, emit `"panel-shown"`. Task 4 reuses it for the shortcut; the renderer plan listens for the event.

- [ ] **Step 1: Create `apps/desktop/src-tauri/src/panel.rs`**

```rust
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_positioner::{Position, WindowExt};

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
    // Requires tauri_plugin_positioner::on_tray_event to have been fed
    // tray events — wired in lib.rs — or the tray position is unknown.
    let _ = window.move_window(Position::TrayBottomCenter);
    let _ = window.show();
    let _ = window.set_focus();
    let _ = app.emit("panel-shown", ());
}
```

- [ ] **Step 2: Wire the tray in `lib.rs`**

Replace `apps/desktop/src-tauri/src/lib.rs` — this builds on the Rust core plan's final version (commands + log plugin). If that plan has not run yet, keep whatever `invoke_handler` line the file currently has and apply only the additions:

```rust
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
        .invoke_handler(tauri::generate_handler![commands::list_ports, commands::kill_port])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 3: Compile check + manual verification**

Run: `cd apps/desktop/src-tauri && cargo check`
Expected: clean.

Run: `bun run dev:desktop`
Manual checklist:

- [ ] No window at launch; an icon appears in the menu bar
- [ ] Left-click opens the panel directly under the icon
- [ ] Second click hides it
- [ ] Terminal shows no `toggle_panel: no window` warning

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src-tauri/src
git commit -m "feat(desktop-shell): tray icon toggling a positioned panel"
```

---

### Task 3: Accessory activation policy + hide-on-blur

**Files:**

- Modify: `apps/desktop/src-tauri/src/lib.rs`

**Interfaces:**

- Consumes: Task 2's setup closure.
- Produces: no Dock icon, no app switcher entry; the panel hides when focus leaves it.

- [ ] **Step 1: Accessory policy**

Inside the `setup` closure in `lib.rs`, add as the first lines:

```rust
            // Menu-bar app: no Dock icon, no ⌘Tab entry (spec §4.6).
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
```

- [ ] **Step 2: Hide on blur**

Add to the builder chain, after `.setup(...)`:

```rust
        .on_window_event(|window, event| {
            // A menu-bar panel dismisses itself when focus leaves it.
            // Note for development: opening the inspector steals focus and
            // closes the panel — use the browser dev loop for UI work.
            if let tauri::WindowEvent::Focused(false) = event {
                let _ = window.hide();
            }
        })
```

- [ ] **Step 3: Compile + manual verification**

Run: `cd apps/desktop/src-tauri && cargo check`, then `bun run dev:desktop`
Manual checklist:

- [ ] No Dock icon while the app runs; ⌘Tab does not list it
- [ ] Open the panel, click the desktop → the panel hides
- [ ] Open the panel, click another app's window → the panel hides
- [ ] Tray click still reopens it afterwards

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src-tauri/src/lib.rs
git commit -m "feat(desktop-shell): accessory policy and hide-on-blur"
```

---

### Task 4: Global shortcut ⌥⌘P

**Files:**

- Modify: `apps/desktop/src-tauri/src/lib.rs`

**Interfaces:**

- Consumes: `panel::toggle_panel` (Task 2).
- Produces: ⌥⌘P toggles the panel from anywhere. (Configurable shortcut is v0.2 — this registers the spec default.)

- [ ] **Step 1: Register the shortcut**

The global-shortcut plugin registers inside `setup` (its builder can error, and `setup` is where `?` works). Add to the top of the `setup` closure in `lib.rs`:

```rust
            {
                use tauri_plugin_global_shortcut::{Code, Modifiers, ShortcutState};

                app.handle().plugin(
                    tauri_plugin_global_shortcut::Builder::new()
                        .with_shortcuts(["alt+cmd+p"])?
                        .with_handler(|app, shortcut, event| {
                            if event.state == ShortcutState::Pressed
                                && shortcut.matches(Modifiers::ALT | Modifiers::META, Code::KeyP)
                            {
                                crate::panel::toggle_panel(app);
                            }
                        })
                        .build(),
                )?;
            }
```

- [ ] **Step 2: Compile + manual verification**

Run: `cd apps/desktop/src-tauri && cargo check`, then `bun run dev:desktop`
Manual checklist:

- [ ] ⌥⌘P opens the panel from any app, positioned under the tray icon
- [ ] ⌥⌘P again hides it
- [ ] macOS may ask for Accessibility/Input Monitoring permission — grant it and note whether it was required (goes in the docs troubleshooting page later)

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src-tauri/src/lib.rs
git commit -m "feat(desktop-shell): global shortcut alt+cmd+p toggles the panel"
```

---

### Task 5: Full acceptance pass

**Files:** none (verification only; fixes get their own commits).

- [ ] **Step 1: The spec's MVP loop, end to end**

With the Rust core and renderer plans merged and `bun dev` running in another project:

- [ ] Launch `bun run dev:desktop`: nothing on screen, icon in the menu bar, no Dock entry
- [ ] ⌥⌘P → panel opens under the icon, search focused, real ports listed within a beat
- [ ] Type the dev server's port → one row remains
- [ ] Kill it (✕ → "Kill?") → toast, row gone on next poll
- [ ] Click anywhere else → panel hides; ⌥⌘P brings it back with fresh data ("panel-shown" refetch)
- [ ] Total time from shortcut to confirmed kill: under 3 seconds (spec "done means")

- [ ] **Step 2: Commit fixes if any surfaced**

```bash
git add -A apps/desktop
git commit -m "fix(desktop-shell): adjustments from acceptance pass"
```
