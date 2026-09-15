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
| `dev`         | Vite only. Tauri calls it via `beforeDevCommand` — not useful alone |
| `build`       | Vite only. Tauri calls it via `beforeBuildCommand`                  |
| `tauri:dev`   | The actual app                                                      |
| `tauri:build` | The actual bundle                                                   |
| `check-types` | `tsc --noEmit` over the renderer                                    |

Because `dev` is the headless half, the root `dev` script filters this package out. Renaming either
script means editing `src-tauri/tauri.conf.json` in the same commit.

## Layout

```
src/                  React renderer — never touches Node
src-tauri/
  src/lib.rs          Tauri builder, plugins, invoke_handler
  src/main.rs         Binary entry — calls port_watcher_lib::run()
  tauri.conf.json     Window, bundle, identifier (dev.csdev19.portwatcher)
  capabilities/       Per-window permission grants
  Cargo.toml          Crate `port-watcher`, lib `port_watcher_lib`
```

The renderer talks to Rust only through `invoke()`. Commands must be registered in
`generate_handler![]` in `lib.rs` and permitted in `capabilities/default.json`.
