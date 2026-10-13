# desktop — chapay (Tauri 2)

Menu-bar app that lists the TCP ports in `LISTEN`, explains what each process is, and kills the one
you point at. React + TypeScript + Vite renderer; Rust core in `src-tauri/`.

## Running it

From the monorepo root:

```bash
bun run dev:desktop     # tauri dev — compiles Rust, opens the window
bun run build:desktop   # tauri build — .app / .dmg bundle
```

Requires the Rust toolchain (`rustup`) and Xcode Command Line Tools. See
[Tauri prerequisites](https://tauri.app/start/prerequisites/).

## Scripts, and why they look odd

| Script        | What it does                                                        |
| ------------- | ------------------------------------------------------------------- |
| `vite:dev`    | Vite only. Tauri calls it via `beforeDevCommand` — not useful alone |
| `build`       | Vite only. Tauri calls it via `beforeBuildCommand`                  |
| `tauri:dev`   | The actual app                                                      |
| `tauri:build` | The actual bundle                                                   |
| `check-types` | `tsc --noEmit` over the renderer                                    |
| `test`        | `vitest run` over the renderer                                      |

There is deliberately no script named `dev`: Turbo runs a task by name in every package that
defines it, so a `dev` here would start a second, windowless Vite on port 1420 next to the one Tauri
starts. That is what lets the root `dev` script run `turbo run dev tauri:dev`. Renaming `vite:dev`
or `build` means editing `src-tauri/tauri.conf.json` in the same commit.

## What it is today

The app is shipped (`desktop-v0.1.0`, signed and notarized DMGs). The Rust core exposes
`list_ports` and `kill_port`; the tray icon toggles a 340×440 undecorated, always-on-top panel
(also on `⌥⌘P`); the panel hides when it loses focus. Releases: see
`apps/documentation/src/content/docs/desktop/releasing.mdx`. Using it: see the install and usage
pages on the docs site.

## Layout

```
src/                  React renderer — never touches Node
src-tauri/
  src/lib.rs          Tauri builder, tray, global shortcut, invoke_handler
  src/panel.rs        toggle_panel: position under the tray icon, show/hide
  src/commands.rs     list_ports and kill_port (async, off the main thread)
  src/ports/          listener scan, labels, project detection, classification, kill guards
  src/main.rs         Binary entry — calls port_watcher_lib::run()
  tauri.conf.json     Window, bundle, identifier (dev.csdev19.portwatcher)
  capabilities/       Per-window permission grants
  Cargo.toml          Crate `port-watcher`, lib `port_watcher_lib`
```

The renderer talks to Rust only through `invoke()`. Commands must be registered in
`generate_handler![]` in `lib.rs` and permitted in `capabilities/default.json`.
