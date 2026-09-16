# chapay — port watcher · MVP Spec (v0.1)

Local-first macOS menu-bar app (Tauri 2) that lists the TCP ports in `LISTEN`,
explains what each process is and which project it came from, and kills the one
you point at. Name: **chapay** (Quechua _chapay_, to watch/guard), lowercase;
full title "chapay — port watcher". Trademark/domain/registry checks pending.

Translated and updated from the original Spanish spec (2026-09-15). Decisions
resolved since: the name, and the `listeners` crate API (verified 0.6.1 —
exposes protocol and socket state, so no `lsof` fallback is needed on macOS).

## Problem

With several dev servers running (vite, next, wrangler, bun, docker, postgres),
ports stay held by orphaned processes. The shell workaround
(`lsof -w -n -i tcp:PORT` + `kill -9 PID`) works but is slow and says nothing
about _what_ the process is or _which project_ it belongs to.

## Goal

See every listening port in one click and kill the right one without thinking:
which port, what it is (Vite, Next, Postgres…), which folder it came from, one
click to kill. Out of scope for v1: traffic, outbound connections, UDP,
firewall, remote administration.

## MVP scope (v0.1)

1. Menu-bar icon; clicking it opens a panel anchored to the icon.
2. List of the current user's TCP `LISTEN` ports, auto-refreshing while the
   panel is visible (2 s polling; zero polling while hidden).
3. Each row: port, smart label, project folder, PID, uptime, memory.
4. **Kill** in one click: SIGTERM first; SIGKILL if still alive after 2 s.
5. Search by port, name or folder. Focused when the panel opens; typing `3000`
   filters instantly.
6. No Dock presence (accessory app). Panel hides on blur.
7. Global shortcut (⌥⌘P) to toggle the panel.

v0.2+: group by project, custom labels, favorite ports, notifications, extra
row actions, Windows/Linux, CLI, Docker container names.

## Smart labels

Ordered rules over the full command line, first match wins. Rules live in an
embedded JSON file so adding one never touches Rust code:

| Command contains…                                   | Label                           |
| --------------------------------------------------- | ------------------------------- |
| `next dev` / `next-server`                          | Next.js dev                     |
| `vite`                                              | Vite                            |
| `wrangler` / `workerd`                              | Wrangler (Workers)              |
| `astro dev`                                         | Astro                           |
| `expo start` / `metro`                              | Expo / Metro                    |
| `nest start`                                        | NestJS                          |
| `tanstack` / `vinxi`                                | TanStack Start                  |
| `convex dev`                                        | Convex                          |
| `postgres`                                          | PostgreSQL                      |
| `redis-server`                                      | Redis                           |
| `com.docker` / `vpnkit`                             | Docker                          |
| `laqi`                                              | laqi mock server                |
| runtime is `bun`/`node`/`python` (no earlier match) | `bun · server.ts` (script name) |
| nothing                                             | process name                    |

**Project detection:** walk up from the process cwd until `package.json`,
`Cargo.toml` or `.git`; use the `package.json` `name` if present, else the
folder name. **Dedupe:** same PID+port on IPv4 and IPv6 is one row.

## Architecture

Tauri 2. Frontend: React + TS + Vite, CSS Modules, TanStack Query (2 s polling
while visible). Core (Rust): commands `list_ports` and `kill_port`; port source
`listeners` 0.6.1; enrichment `sysinfo` (cmd, cwd, memory, start_time, user);
signals via `nix`. Plugins: tray-icon (feature), positioner, global-shortcut;
store/autostart/updater/opener arrive after the MVP. Tooling: bun for
everything (this repo does not use pnpm).

### Data model

```rust
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortEntry {
    pub port: u16,
    pub pid: u32,
    pub process_name: String,
    pub command: String,        // full cmdline
    pub cwd: Option<String>,    // tilde-abbreviated
    pub project: Option<String>,
    pub label: String,
    pub user: Option<String>,
    pub started_at: u64,        // epoch secs; doubles as the kill guard
    pub memory_bytes: u64,
    pub killable: bool,         // same user
}
```

### Commands

```rust
#[tauri::command] async fn list_ports() -> Result<Vec<PortEntry>, AppError>;
#[tauri::command] async fn kill_port(pid: u32, port: u16, started_at: u64)
    -> Result<KillResult, AppError>;
// KillResult = Terminated | Killed | AlreadyGone | PermissionDenied
```

**`kill_port` safety:**

1. PID-reuse guard: before signalling, confirm the PID still listens on `port`
   and its `started_at` matches; otherwise return `AlreadyGone`.
2. Never kill a PID below 100, the app's own process, or another user's
   process (no sudo in v1).
3. SIGTERM, poll every 100 ms up to 2 s, then SIGKILL.

**Capabilities:** the main window may invoke only the app's commands and the
listed plugins. No shell exposed to the frontend.

### macOS specifics

`ActivationPolicy::Accessory` (no Dock), undecorated window, `always_on_top`,
hidden on `WindowEvent::Focused(false)`. Vibrancy via `window-vibrancy` comes
with the design pass, not the functional MVP.

## UX summary

360 × 480 panel: search on top (autofocused), dense rows (port in mono 18–20px,
label weight 500, muted folder with `~` and middle truncation, uptime, ✕ on
hover), footer "N ports · updated Xs ago". Kill button turns into "Kill?" for
2 s; second click confirms; `⌘⌫` on the focused row kills without confirming.
Keyboard: `↑↓` navigate, `Enter` expand, `Esc` close. States: populated, empty
("All ports free"), filtered-empty, no-permission (lock), read error (retry),
toast after kill ("Vite (5173) stopped · Copy command"). Full visual direction
lives in the design brief (`apps/documentation/src/content/docs/briefings/design-brief.mdx`).

## Milestones

1. ~~Scaffold, accessory app, tray icon~~ (scaffold done 2026-09-15)
2. `list_ports` (listeners + sysinfo) with tests
3. Labels + project detection with unit tests
4. UI: list, search, keyboard, states
5. `kill_port` with PID-reuse guard, toasts
6. Positioner, hide-on-blur, global shortcut, autostart
7. Visual polish: vibrancy, themes, icon (design pass)
8. CI, signing, notarization, updater, v0.1.0

**Done means:** with `bun dev` running in three projects, open the panel with
the shortcut, identify each process by name and folder without reading the
command, and kill one in under 3 seconds.
