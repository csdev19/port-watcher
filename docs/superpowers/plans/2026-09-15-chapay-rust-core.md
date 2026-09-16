# chapay Rust Core (`list_ports` + `kill_port`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The two Tauri commands that make chapay real — `list_ports` (enumerate TCP LISTEN ports, enriched with smart labels, project folder, uptime, memory, owner) and `kill_port` (SIGTERM→SIGKILL with a PID-reuse guard).

**Architecture:** A `ports` module in `src-tauri/src/` split by responsibility: `source.rs` (the `listeners` crate + dedupe), `label.rs` (embedded JSON rules), `project.rs` (walk up from cwd), `enrich.rs` (`sysinfo`), `kill.rs` (guards + signal escalation). Commands in `commands.rs` are thin async wrappers over `spawn_blocking`. All pure logic is unit-tested; OS calls are kept in thin, obvious seams.

**Tech Stack:** Rust, Tauri 2, `listeners` 0.6, `sysinfo` 0.39, `nix` 0.29 (signals), `thiserror`, `serde`/`serde_json`, `tauri-plugin-log` 2.

**Spec:** `docs/specs/2026-09-15-chapay-mvp-spec.md`

## Global Constraints

- Everything committed is English: code, comments, tests, commit messages.
- Serialization contract: `#[serde(rename_all = "camelCase")]` on every type crossing IPC. The renderer plan consumes exactly these field names.
- `kill_port` hard rules (spec): never signal a PID below 100, the app's own PID, or another user's process; verify PID+port+`started_at` before signalling; SIGTERM, poll 100 ms up to 2 s, then SIGKILL.
- Run all Rust commands from `apps/desktop/src-tauri/` (it is NOT a bun workspace member; cargo only).
- Tauri custom commands need no capability entries (capabilities govern core/plugin permissions only).
- Commit after every task; lefthook runs lint/format on commit.

---

### Task 1: Cargo dependencies + `listeners` API smoke test

The spec's one open risk was the `listeners` API. Verified against docs.rs 0.6.1: `listeners::get_all() -> Result<HashSet<Listener>, Box<dyn Error>>`, `Listener { process: Process, socket: SocketAddr, protocol: Protocol, state: SocketState }` (all pub). The `Process` sub-struct's exact field names were not visible in docs — this task pins them with a compile-checked smoke test. If a field or enum variant differs, fix it HERE (rustc's suggestion will name the real one) and adjust nothing else: `source.rs` (Task 3) is the only other place that touches this API.

**Files:**

- Modify: `apps/desktop/src-tauri/Cargo.toml`
- Create: `apps/desktop/src-tauri/src/ports/mod.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs` (add `mod ports;`)

**Interfaces:**

- Consumes: nothing.
- Produces: the dependency set every later task assumes, and ground truth on `listeners` field names.

- [ ] **Step 1: Add dependencies to `Cargo.toml`**

Under `[dependencies]` in `apps/desktop/src-tauri/Cargo.toml`, add:

```toml
listeners = "0.6"
sysinfo = "0.39"
thiserror = "2"
nix = { version = "0.29", features = ["signal"] }
log = "0.4"
```

And a new dev-dependencies section at the end of the file:

```toml
[dev-dependencies]
tempfile = "3"
```

- [ ] **Step 2: Create the module with the smoke test**

Create `apps/desktop/src-tauri/src/ports/mod.rs`:

```rust
//! Port enumeration and process control. Split by responsibility:
//! source (listeners crate), label (rules), project (cwd walk),
//! enrich (sysinfo), kill (guards + signals).

#[cfg(test)]
mod listeners_api_smoke {
    /// Pins the `listeners` 0.6 API surface we depend on. If this stops
    /// compiling after a crate bump, `source.rs` is the only production
    /// file that needs the same fix.
    #[test]
    fn get_all_exposes_pid_name_port_and_protocol() {
        let all = listeners::get_all().expect("listeners::get_all failed");
        // Field-access compile check + runtime sanity on a real machine
        // (the test process itself doesn't need to be listening).
        for l in all.iter().take(5) {
            let _pid: u32 = l.process.pid;
            let _name: &str = &l.process.name;
            let _port: u16 = l.socket.port();
            let _proto = &l.protocol; // Protocol enum
            let _state = &l.state; // SocketState enum
        }
        // Protocol variant name check — adjust if rustc suggests otherwise.
        let tcp_only: Vec<_> = all
            .iter()
            .filter(|l| l.protocol == listeners::Protocol::TCP)
            .collect();
        // A dev machine virtually always has at least one TCP listener.
        assert!(!tcp_only.is_empty(), "expected at least one TCP listener");
    }
}
```

In `apps/desktop/src-tauri/src/lib.rs`, add as the first line:

```rust
mod ports;
```

- [ ] **Step 3: Run the test — expect it to surface any API drift**

Run: `cd apps/desktop/src-tauri && cargo test listeners_api_smoke`
Expected: PASS. If it fails to compile, rustc names the real field/variant (e.g. `Protocol::Tcp` instead of `TCP`, or `l.pid` at the top level). Apply the fix in this test, note the real names, and use them verbatim in Task 3.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src-tauri/Cargo.toml apps/desktop/src-tauri/Cargo.lock apps/desktop/src-tauri/src/ports/mod.rs apps/desktop/src-tauri/src/lib.rs
git commit -m "feat(desktop): add rust core deps and pin listeners API"
```

---

### Task 2: Error type + IPC models

**Files:**

- Create: `apps/desktop/src-tauri/src/error.rs`
- Create: `apps/desktop/src-tauri/src/ports/models.rs`
- Modify: `apps/desktop/src-tauri/src/ports/mod.rs` (declare `pub mod models;`)
- Modify: `apps/desktop/src-tauri/src/lib.rs` (declare `mod error;`)

**Interfaces:**

- Consumes: nothing.
- Produces: `AppError` (serializes as its message string), `PortEntry` (camelCase fields: `port, pid, processName, command, cwd, project, label, user, startedAt, memoryBytes, killable`), `KillResult` (serializes as `"terminated" | "killed" | "alreadyGone" | "permissionDenied"`). The renderer plan's `types.ts` mirrors these exactly.

- [ ] **Step 1: Write the failing serialization tests**

Create `apps/desktop/src-tauri/src/ports/models.rs`:

```rust
use serde::Serialize;

/// One listening port, fully enriched. Field names cross IPC as camelCase —
/// the renderer's `PortEntry` type mirrors this struct verbatim.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortEntry {
    pub port: u16,
    pub pid: u32,
    pub process_name: String,
    pub command: String,
    pub cwd: Option<String>,
    pub project: Option<String>,
    pub label: String,
    pub user: Option<String>,
    /// Epoch seconds. Doubles as the PID-reuse guard in `kill_port`.
    pub started_at: u64,
    pub memory_bytes: u64,
    pub killable: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum KillResult {
    Terminated,
    Killed,
    AlreadyGone,
    PermissionDenied,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn port_entry_serializes_camel_case() {
        let entry = PortEntry {
            port: 5173,
            pid: 4242,
            process_name: "node".into(),
            command: "node /x/vite".into(),
            cwd: Some("~/dev/laqi".into()),
            project: Some("laqi".into()),
            label: "Vite".into(),
            user: Some("cristian".into()),
            started_at: 1_757_000_000,
            memory_bytes: 123_456,
            killable: true,
        };
        let json = serde_json::to_value(&entry).unwrap();
        assert_eq!(json["processName"], "node");
        assert_eq!(json["startedAt"], 1_757_000_000_u64);
        assert_eq!(json["memoryBytes"], 123_456);
        assert!(json.get("process_name").is_none());
    }

    #[test]
    fn kill_result_serializes_as_camel_case_string() {
        assert_eq!(
            serde_json::to_value(KillResult::AlreadyGone).unwrap(),
            serde_json::json!("alreadyGone")
        );
        assert_eq!(
            serde_json::to_value(KillResult::PermissionDenied).unwrap(),
            serde_json::json!("permissionDenied")
        );
    }
}
```

Create `apps/desktop/src-tauri/src/error.rs`:

```rust
use serde::{Serialize, Serializer};

/// Errors crossing IPC serialize as their display string — the renderer
/// shows them in the error state and never matches on variants.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("failed to read listening ports: {0}")]
    PortSource(String),
    #[error("internal error: {0}")]
    Internal(String),
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}
```

Wire the modules: in `src/ports/mod.rs` add `pub mod models;`; in `src/lib.rs` add `mod error;` under `mod ports;`.

- [ ] **Step 2: Run the tests**

Run: `cd apps/desktop/src-tauri && cargo test models`
Expected: 2 PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src-tauri/src
git commit -m "feat(desktop): PortEntry, KillResult and AppError IPC models"
```

---

### Task 3: Port source — TCP listeners, deduped

**Files:**

- Create: `apps/desktop/src-tauri/src/ports/source.rs`
- Modify: `apps/desktop/src-tauri/src/ports/mod.rs` (add `pub mod source;`, remove the Task 1 smoke module — `source.rs` now owns that seam and its own test covers it)

**Interfaces:**

- Consumes: `AppError` (Task 2), the field names pinned in Task 1.
- Produces: `RawPort { pid: u32, port: u16, process_name: String }`, `pub fn raw_ports() -> Result<Vec<RawPort>, AppError>`, `pub fn dedupe(items: impl IntoIterator<Item = RawPort>) -> Vec<RawPort>`. Tasks 6 and 7 call `raw_ports()`.

- [ ] **Step 1: Write the failing dedupe tests**

Create `apps/desktop/src-tauri/src/ports/source.rs`:

```rust
use std::collections::HashSet;

use crate::error::AppError;

/// A listener as the OS reports it, before enrichment.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RawPort {
    pub pid: u32,
    pub port: u16,
    pub process_name: String,
}

/// Same PID+port on IPv4 and IPv6 is one row (spec §6). Output sorted by
/// port so the UI is stable between polls.
pub fn dedupe(items: impl IntoIterator<Item = RawPort>) -> Vec<RawPort> {
    let mut seen: HashSet<(u32, u16)> = HashSet::new();
    let mut out: Vec<RawPort> = items
        .into_iter()
        .filter(|item| seen.insert((item.pid, item.port)))
        .collect();
    out.sort_by_key(|r| (r.port, r.pid));
    out
}

/// All TCP listeners on this machine. We filter by protocol only, not by
/// socket state: `get_all` already returns listeners, and dropping rows on
/// an `UNKNOWN` state would silently hide real ports.
pub fn raw_ports() -> Result<Vec<RawPort>, AppError> {
    let all = listeners::get_all().map_err(|e| AppError::PortSource(e.to_string()))?;
    Ok(dedupe(all.into_iter().filter(|l| l.protocol == listeners::Protocol::TCP).map(
        |l| RawPort {
            pid: l.process.pid,
            port: l.socket.port(),
            process_name: l.process.name.clone(),
        },
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn raw(pid: u32, port: u16) -> RawPort {
        RawPort { pid, port, process_name: format!("p{pid}") }
    }

    #[test]
    fn dedupe_collapses_same_pid_and_port() {
        // IPv4 + IPv6 duplicate of vite on 5173
        let out = dedupe([raw(10, 5173), raw(10, 5173), raw(20, 3000)]);
        assert_eq!(out, vec![raw(20, 3000), raw(10, 5173)]);
    }

    #[test]
    fn dedupe_keeps_same_port_from_different_pids() {
        // SO_REUSEPORT / forked workers: two pids on one port are two rows
        let out = dedupe([raw(10, 8080), raw(11, 8080)]);
        assert_eq!(out.len(), 2);
    }

    #[test]
    fn dedupe_sorts_by_port() {
        let out = dedupe([raw(1, 9000), raw(2, 80), raw(3, 5432)]);
        let ports: Vec<u16> = out.iter().map(|r| r.port).collect();
        assert_eq!(ports, vec![80, 5432, 9000]);
    }

    /// Live seam check (replaces the Task 1 smoke test).
    #[test]
    fn raw_ports_runs_on_this_machine() {
        let out = raw_ports().expect("raw_ports failed");
        // No duplicates by construction:
        let mut seen = std::collections::HashSet::new();
        assert!(out.iter().all(|r| seen.insert((r.pid, r.port))));
    }
}
```

In `src/ports/mod.rs`: add `pub mod source;` and delete the `listeners_api_smoke` module from Task 1 (its job moved into `raw_ports_runs_on_this_machine`).

- [ ] **Step 2: Run the tests**

Run: `cd apps/desktop/src-tauri && cargo test source`
Expected: 4 PASS. (If Task 1 renamed any field/variant, apply the same names here.)

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src-tauri/src/ports
git commit -m "feat(desktop): TCP port source with ipv4/ipv6 dedupe"
```

---

### Task 4: Smart labels — embedded JSON rules

**Files:**

- Create: `apps/desktop/src-tauri/src/ports/label_rules.json`
- Create: `apps/desktop/src-tauri/src/ports/label.rs`
- Modify: `apps/desktop/src-tauri/src/ports/mod.rs` (add `pub mod label;`)

**Interfaces:**

- Consumes: nothing.
- Produces: `pub fn label_for(command: &str, process_name: &str) -> String`. Task 6 calls it per row.

- [ ] **Step 1: Create the rules file**

Create `apps/desktop/src-tauri/src/ports/label_rules.json` — the spec table verbatim, ordered, first match wins. Adding a rule never touches Rust:

```json
[
  { "contains": ["next dev", "next-server"], "label": "Next.js dev" },
  { "contains": ["vite"], "label": "Vite" },
  { "contains": ["wrangler", "workerd"], "label": "Wrangler (Workers)" },
  { "contains": ["astro dev"], "label": "Astro" },
  { "contains": ["expo start", "metro"], "label": "Expo / Metro" },
  { "contains": ["nest start"], "label": "NestJS" },
  { "contains": ["tanstack", "vinxi"], "label": "TanStack Start" },
  { "contains": ["convex dev"], "label": "Convex" },
  { "contains": ["postgres"], "label": "PostgreSQL" },
  { "contains": ["redis-server"], "label": "Redis" },
  { "contains": ["com.docker", "vpnkit"], "label": "Docker" },
  { "contains": ["laqi"], "label": "laqi mock server" }
]
```

- [ ] **Step 2: Write the failing tests + implementation**

Create `apps/desktop/src-tauri/src/ports/label.rs`:

```rust
use std::path::Path;
use std::sync::OnceLock;

use serde::Deserialize;

#[derive(Deserialize)]
struct Rule {
    contains: Vec<String>,
    label: String,
}

fn rules() -> &'static [Rule] {
    static RULES: OnceLock<Vec<Rule>> = OnceLock::new();
    RULES.get_or_init(|| {
        serde_json::from_str(include_str!("label_rules.json"))
            .expect("label_rules.json is invalid — fix the embedded rules file")
    })
}

/// Spec §6: ordered substring rules over the lowercased full command line;
/// then the runtime fallback (`bun · server.ts`); then the process name.
pub fn label_for(command: &str, process_name: &str) -> String {
    let cmd_lc = command.to_lowercase();
    for rule in rules() {
        if rule.contains.iter().any(|needle| cmd_lc.contains(needle.as_str())) {
            return rule.label.clone();
        }
    }
    if let Some(runtime) = runtime_of(&cmd_lc) {
        if let Some(script) = script_name(command) {
            return format!("{runtime} · {script}");
        }
    }
    process_name.to_string()
}

/// The runtime match is on the executable token's file stem, NOT a substring —
/// otherwise every path containing "node_modules" would match "node".
fn runtime_of(cmd_lc: &str) -> Option<&'static str> {
    let first = cmd_lc.split_whitespace().next()?;
    match Path::new(first).file_stem()?.to_str()? {
        "bun" => Some("bun"),
        "node" => Some("node"),
        "python" | "python3" => Some("python"),
        _ => None,
    }
}

/// First non-flag argument, preferring one that looks like a file. Only its
/// basename: `bun /a/b/server.ts` → `server.ts`.
fn script_name(command: &str) -> Option<String> {
    let args: Vec<&str> = command
        .split_whitespace()
        .skip(1)
        .filter(|t| !t.starts_with('-'))
        .collect();
    let picked = args.iter().find(|t| t.contains('.')).or_else(|| args.first())?;
    Some(
        Path::new(picked)
            .file_name()
            .map(|f| f.to_string_lossy().into_owned())
            .unwrap_or_else(|| (*picked).to_string()),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_spec_rule_matches() {
        let cases = [
            ("node /x/.bin/next dev", "Next.js dev"),
            ("next-server --port 3000", "Next.js dev"),
            ("node /p/node_modules/.bin/vite", "Vite"),
            ("node /x/wrangler dev", "Wrangler (Workers)"),
            ("/y/workerd serve", "Wrangler (Workers)"),
            ("node /x/astro dev", "Astro"),
            ("node /x/expo start", "Expo / Metro"),
            ("node /x/metro start", "Expo / Metro"),
            ("node /x/nest start --watch", "NestJS"),
            ("node /x/vinxi dev", "TanStack Start"),
            ("node /x/convex dev", "Convex"),
            ("/opt/homebrew/bin/postgres -D /data", "PostgreSQL"),
            ("redis-server *:6379", "Redis"),
            ("/Applications/com.docker.backend", "Docker"),
            ("/x/vpnkit --port 2375", "Docker"),
            ("bun /x/laqi/server.ts", "laqi mock server"),
        ];
        for (cmd, expected) in cases {
            assert_eq!(label_for(cmd, "irrelevant"), expected, "for {cmd}");
        }
    }

    #[test]
    fn first_matching_rule_wins() {
        // Contains both "vite" and "postgres" — "vite" is earlier in the file.
        assert_eq!(label_for("vite --db postgres", "x"), "Vite");
    }

    #[test]
    fn runtime_fallback_uses_script_basename() {
        assert_eq!(label_for("/usr/local/bin/bun /a/b/server.ts", "bun"), "bun · server.ts");
        assert_eq!(label_for("node ./api/index.mjs --port 4000", "node"), "node · index.mjs");
        assert_eq!(label_for("python3 -m http.server", "python3"), "python · http.server");
    }

    #[test]
    fn node_modules_in_path_does_not_trigger_node_runtime() {
        // Executable is deno; path merely contains node_modules.
        assert_eq!(label_for("/x/deno run /p/node_modules/x/serve.ts", "deno"), "deno");
    }

    #[test]
    fn no_match_falls_back_to_process_name() {
        assert_eq!(label_for("/usr/libexec/weirdd --flag", "weirdd"), "weirdd");
    }

    #[test]
    fn empty_command_falls_back_to_process_name() {
        assert_eq!(label_for("", "rapportd"), "rapportd");
    }
}
```

Add `pub mod label;` to `src/ports/mod.rs`.

- [ ] **Step 3: Run the tests**

Run: `cd apps/desktop/src-tauri && cargo test label`
Expected: 6 PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src-tauri/src/ports
git commit -m "feat(desktop): smart label engine with embedded json rules"
```

---

### Task 5: Project detection + home tildify

**Files:**

- Create: `apps/desktop/src-tauri/src/ports/project.rs`
- Modify: `apps/desktop/src-tauri/src/ports/mod.rs` (add `pub mod project;`)

**Interfaces:**

- Consumes: nothing.
- Produces: `pub fn detect_project(cwd: &Path) -> Option<String>`, `pub fn tildify(path: &str, home: Option<&str>) -> String`. Task 6 calls both.

- [ ] **Step 1: Write the failing tests + implementation**

Create `apps/desktop/src-tauri/src/ports/project.rs`:

```rust
use std::path::Path;

/// Spec §6: walk up from the cwd until `package.json`, `Cargo.toml` or
/// `.git`; prefer the `package.json` "name", else the folder name.
pub fn detect_project(cwd: &Path) -> Option<String> {
    for dir in cwd.ancestors() {
        let pkg = dir.join("package.json");
        if pkg.is_file() {
            return pkg_name(&pkg).or_else(|| dir_name(dir));
        }
        if dir.join("Cargo.toml").is_file() || dir.join(".git").exists() {
            return dir_name(dir);
        }
    }
    None
}

fn pkg_name(path: &Path) -> Option<String> {
    let text = std::fs::read_to_string(path).ok()?;
    let json: serde_json::Value = serde_json::from_str(&text).ok()?;
    Some(json.get("name")?.as_str()?.to_string())
}

fn dir_name(dir: &Path) -> Option<String> {
    Some(dir.file_name()?.to_string_lossy().into_owned())
}

/// `/Users/x/dev/app` → `~/dev/app`. Pure so it's testable; the caller
/// passes `std::env::var("HOME").ok()`.
pub fn tildify(path: &str, home: Option<&str>) -> String {
    match home {
        Some(h) if !h.is_empty() && path.starts_with(h) => format!("~{}", &path[h.len()..]),
        _ => path.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn package_json_name_wins() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("laqi");
        let deep = root.join("apps/web/src");
        fs::create_dir_all(&deep).unwrap();
        fs::write(root.join("package.json"), r#"{ "name": "laqi-panel" }"#).unwrap();
        assert_eq!(detect_project(&deep), Some("laqi-panel".into()));
    }

    #[test]
    fn nearest_marker_wins_in_a_monorepo() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("mono");
        let app = root.join("apps/web");
        fs::create_dir_all(&app).unwrap();
        fs::write(root.join("package.json"), r#"{ "name": "mono-root" }"#).unwrap();
        fs::write(app.join("package.json"), r#"{ "name": "web-app" }"#).unwrap();
        assert_eq!(detect_project(&app), Some("web-app".into()));
    }

    #[test]
    fn package_json_without_name_falls_back_to_folder() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("thing");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("package.json"), r#"{ "private": true }"#).unwrap();
        assert_eq!(detect_project(&root), Some("thing".into()));
    }

    #[test]
    fn cargo_toml_uses_folder_name() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("rusty");
        let src = root.join("src");
        fs::create_dir_all(&src).unwrap();
        fs::write(root.join("Cargo.toml"), "[package]\nname = \"x\"\n").unwrap();
        assert_eq!(detect_project(&src), Some("rusty".into()));
    }

    #[test]
    fn git_dir_uses_folder_name() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("plain");
        fs::create_dir_all(root.join(".git")).unwrap();
        assert_eq!(detect_project(&root), Some("plain".into()));
    }

    #[test]
    fn no_marker_means_none() {
        let tmp = tempfile::tempdir().unwrap();
        assert_eq!(detect_project(tmp.path()), None);
    }

    #[test]
    fn tildify_replaces_home_prefix_only() {
        assert_eq!(tildify("/Users/c/dev/app", Some("/Users/c")), "~/dev/app");
        assert_eq!(tildify("/opt/homebrew", Some("/Users/c")), "/opt/homebrew");
        assert_eq!(tildify("/Users/c/dev", None), "/Users/c/dev");
        assert_eq!(tildify("/Users/c/dev", Some("")), "/Users/c/dev");
    }
}
```

Add `pub mod project;` to `src/ports/mod.rs`.

- [ ] **Step 2: Run the tests**

Run: `cd apps/desktop/src-tauri && cargo test project`
Expected: 7 PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src-tauri/src/ports
git commit -m "feat(desktop): project detection from cwd and home tildify"
```

---

### Task 6: Enrichment + the `list_ports` command (replaces the greet demo)

**Files:**

- Create: `apps/desktop/src-tauri/src/ports/enrich.rs`
- Create: `apps/desktop/src-tauri/src/commands.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs` (drop `greet`, register `list_ports`)
- Modify: `apps/desktop/src-tauri/src/ports/mod.rs` (add `pub mod enrich;`)

**Interfaces:**

- Consumes: `RawPort`/`raw_ports()` (Task 3), `label_for` (Task 4), `detect_project`/`tildify` (Task 5), `PortEntry`/`AppError` (Task 2).
- Produces: `pub fn enrich(raw: Vec<RawPort>) -> Vec<PortEntry>` and the IPC command `list_ports() -> Result<Vec<PortEntry>, AppError>`. The renderer calls `invoke("list_ports")`.

- [ ] **Step 1: Write enrich with its tests**

Create `apps/desktop/src-tauri/src/ports/enrich.rs`:

```rust
use std::path::Path;

use sysinfo::{Pid, ProcessesToUpdate, System, Users};

use super::label::label_for;
use super::models::PortEntry;
use super::project::{detect_project, tildify};
use super::source::RawPort;

/// Join sysinfo data onto the raw listener rows. A PID that vanished
/// between the listeners call and here still yields a row (minimal data)
/// rather than disappearing mid-poll.
pub fn enrich(raw: Vec<RawPort>) -> Vec<PortEntry> {
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::All, true);
    let users = Users::new_with_refreshed_list();
    let my_uid = nix::unistd::Uid::effective().as_raw();
    let self_pid = std::process::id();
    let home = std::env::var("HOME").ok();

    raw.into_iter()
        .map(|r| entry_for(r, &sys, &users, my_uid, self_pid, home.as_deref()))
        .collect()
}

fn entry_for(
    raw: RawPort,
    sys: &System,
    users: &Users,
    my_uid: u32,
    self_pid: u32,
    home: Option<&str>,
) -> PortEntry {
    let proc = sys.process(Pid::from_u32(raw.pid));

    let command = proc
        .map(|p| {
            p.cmd()
                .iter()
                .map(|s| s.to_string_lossy())
                .collect::<Vec<_>>()
                .join(" ")
        })
        .filter(|c| !c.is_empty())
        .unwrap_or_else(|| raw.process_name.clone());

    let cwd_raw = proc.and_then(|p| p.cwd()).map(|p| p.display().to_string());
    let project = cwd_raw.as_deref().and_then(|c| detect_project(Path::new(c)));
    let cwd = cwd_raw.map(|c| tildify(&c, home));

    let uid = proc.and_then(|p| p.user_id());
    let same_user = uid.map(|u| **u == my_uid).unwrap_or(false);

    PortEntry {
        port: raw.port,
        pid: raw.pid,
        label: label_for(&command, &raw.process_name),
        command,
        cwd,
        project,
        user: uid
            .and_then(|u| users.get_user_by_id(u))
            .map(|u| u.name().to_string()),
        started_at: proc.map(|p| p.start_time()).unwrap_or(0),
        memory_bytes: proc.map(|p| p.memory()).unwrap_or(0),
        killable: same_user && raw.pid >= 100 && raw.pid != self_pid,
        process_name: raw.process_name,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// End-to-end against the live machine: spawn a real TCP listener and
    /// find ourselves through the whole pipeline.
    #[test]
    fn finds_our_own_test_listener() {
        use std::net::TcpListener;
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();

        let raw = crate::ports::source::raw_ports().expect("raw_ports failed");
        let entries = enrich(raw);
        let me = entries
            .iter()
            .find(|e| e.port == port)
            .expect("our test listener should be in the list");

        assert_eq!(me.pid, std::process::id());
        // Our own PID is never killable (self-kill guard).
        assert!(!me.killable);
        assert!(me.started_at > 0);
        drop(listener);
    }

    #[test]
    fn vanished_pid_still_yields_a_row() {
        let sys = System::new(); // deliberately not refreshed: knows no PIDs
        let users = Users::new_with_refreshed_list();
        let raw = RawPort { pid: 999_999, port: 4321, process_name: "ghost".into() };
        let e = entry_for(raw, &sys, &users, 501, 1, Some("/Users/x"));
        assert_eq!(e.command, "ghost");
        assert_eq!(e.label, "ghost");
        assert_eq!(e.cwd, None);
        assert!(!e.killable);
        assert_eq!(e.started_at, 0);
    }
}
```

Add `pub mod enrich;` to `src/ports/mod.rs`.

- [ ] **Step 2: Run the enrich tests**

Run: `cd apps/desktop/src-tauri && cargo test enrich`
Expected: 2 PASS. (`sysinfo` API drift — e.g. `refresh_processes` arity — surfaces here; rustc names the fix.)

- [ ] **Step 3: Create the command and rewire lib.rs**

Create `apps/desktop/src-tauri/src/commands.rs`:

```rust
use crate::error::AppError;
use crate::ports::enrich::enrich;
use crate::ports::models::PortEntry;
use crate::ports::source::raw_ports;

/// Both the listeners scan and sysinfo refresh block; keep them off the
/// main thread so the tray/UI never stutters.
#[tauri::command]
pub async fn list_ports() -> Result<Vec<PortEntry>, AppError> {
    tauri::async_runtime::spawn_blocking(|| Ok(enrich(raw_ports()?)))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}
```

Replace `apps/desktop/src-tauri/src/lib.rs` with:

```rust
mod commands;
mod error;
mod ports;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![commands::list_ports])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

(The `greet` demo function is gone; the renderer plan removes its UI half.)

- [ ] **Step 4: Full check + all tests**

Run: `cd apps/desktop/src-tauri && cargo check && cargo test`
Expected: check clean; all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src-tauri/src
git commit -m "feat(desktop): list_ports command with sysinfo enrichment"
```

---

### Task 7: `kill_port` — guards, then SIGTERM→SIGKILL

**Files:**

- Create: `apps/desktop/src-tauri/src/ports/kill.rs`
- Modify: `apps/desktop/src-tauri/src/commands.rs` (add `kill_port`)
- Modify: `apps/desktop/src-tauri/src/lib.rs` (register it)
- Modify: `apps/desktop/src-tauri/src/ports/mod.rs` (add `pub mod kill;`)

**Interfaces:**

- Consumes: `raw_ports()` (Task 3), `KillResult`/`AppError` (Task 2).
- Produces: IPC command `kill_port(pid: u32, port: u16, started_at: u64) -> Result<KillResult, AppError>`. The renderer calls `invoke("kill_port", { pid, port, startedAt })` — Tauri maps camelCase JS args to snake_case Rust params.

- [ ] **Step 1: Write the failing tests + implementation**

Create `apps/desktop/src-tauri/src/ports/kill.rs`:

```rust
use std::time::Duration;

use nix::errno::Errno;
use nix::sys::signal::{self, Signal};
use nix::unistd::Pid as NixPid;
use sysinfo::{Pid, ProcessesToUpdate, System};

use crate::error::AppError;

use super::models::KillResult;
use super::source::raw_ports;

/// The static half of the spec's safety rules, pure so it's unit-testable:
/// never signal a PID below 100 or our own process.
pub fn static_guard(pid: u32, self_pid: u32) -> Option<KillResult> {
    if pid < 100 || pid == self_pid {
        return Some(KillResult::PermissionDenied);
    }
    None
}

/// Full guard chain, then escalation. Blocking (sleeps up to ~2 s) — the
/// command wraps it in spawn_blocking.
pub fn kill_port_impl(pid: u32, port: u16, started_at: u64) -> Result<KillResult, AppError> {
    if let Some(denied) = static_guard(pid, std::process::id()) {
        return Ok(denied);
    }

    // PID-reuse guard 1: that PID must still be listening on that port.
    let still_listening = raw_ports()?.iter().any(|r| r.pid == pid && r.port == port);
    if !still_listening {
        return Ok(KillResult::AlreadyGone);
    }

    // PID-reuse guard 2: same start time = same process incarnation.
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::Some(&[Pid::from_u32(pid)]), true);
    let Some(proc) = sys.process(Pid::from_u32(pid)) else {
        return Ok(KillResult::AlreadyGone);
    };
    if proc.start_time() != started_at {
        return Ok(KillResult::AlreadyGone);
    }

    // Ownership: v1 never signals another user's process (no sudo).
    let my_uid = nix::unistd::Uid::effective().as_raw();
    if proc.user_id().map(|u| **u) != Some(my_uid) {
        return Ok(KillResult::PermissionDenied);
    }

    Ok(escalate(pid))
}

/// SIGTERM, poll every 100 ms up to 2 s, then SIGKILL (spec §7).
fn escalate(pid: u32) -> KillResult {
    let target = NixPid::from_raw(pid as i32);
    match signal::kill(target, Signal::SIGTERM) {
        Err(Errno::ESRCH) => return KillResult::AlreadyGone,
        Err(_) => return KillResult::PermissionDenied,
        Ok(()) => {}
    }
    for _ in 0..20 {
        std::thread::sleep(Duration::from_millis(100));
        if !alive(target) {
            return KillResult::Terminated;
        }
    }
    let _ = signal::kill(target, Signal::SIGKILL);
    KillResult::Killed
}

/// Signal 0 probes existence. EPERM means "exists, not ours" = alive.
fn alive(pid: NixPid) -> bool {
    match signal::kill(pid, None) {
        Ok(()) => true,
        Err(Errno::EPERM) => true,
        Err(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn static_guard_blocks_low_pids_and_self() {
        assert_eq!(static_guard(1, 5000), Some(KillResult::PermissionDenied));
        assert_eq!(static_guard(99, 5000), Some(KillResult::PermissionDenied));
        assert_eq!(static_guard(5000, 5000), Some(KillResult::PermissionDenied));
        assert_eq!(static_guard(100, 5000), None);
        assert_eq!(static_guard(4242, 5000), None);
    }

    #[test]
    fn pid_not_listening_on_port_is_already_gone() {
        // Port 1 with a huge pid: nothing real matches → AlreadyGone,
        // and crucially nothing gets signalled.
        let out = kill_port_impl(999_999, 1, 42).unwrap();
        assert_eq!(out, KillResult::AlreadyGone);
    }

    /// Full escalation path against a real child we own: spawn a sleep
    /// that ignores nothing, bind it? No — simplest honest test: spawn a
    /// child, then run escalate() directly and assert it dies via SIGTERM.
    #[test]
    fn escalate_terminates_a_real_child() {
        let child = std::process::Command::new("sleep").arg("30").spawn().unwrap();
        let pid = child.id();
        let result = escalate(pid);
        assert_eq!(result, KillResult::Terminated);
        assert!(!alive(NixPid::from_raw(pid as i32)));
    }
}
```

Add `pub mod kill;` to `src/ports/mod.rs`.

Append to `apps/desktop/src-tauri/src/commands.rs`:

```rust
use crate::ports::kill::kill_port_impl;
use crate::ports::models::KillResult;

#[tauri::command]
pub async fn kill_port(pid: u32, port: u16, started_at: u64) -> Result<KillResult, AppError> {
    tauri::async_runtime::spawn_blocking(move || kill_port_impl(pid, port, started_at))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}
```

In `lib.rs`, extend the handler:

```rust
        .invoke_handler(tauri::generate_handler![commands::list_ports, commands::kill_port])
```

- [ ] **Step 2: Run the tests**

Run: `cd apps/desktop/src-tauri && cargo test kill`
Expected: 3 PASS (the escalate test takes ~100–300 ms — sleep dies on SIGTERM).

- [ ] **Step 3: Full suite + check**

Run: `cd apps/desktop/src-tauri && cargo check && cargo test`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src-tauri/src
git commit -m "feat(desktop): kill_port with pid-reuse guard and sigterm-sigkill escalation"
```

---

### Task 8: Wire `tauri-plugin-log`

Decided earlier in the project: logging goes in before the commands are debugged in anger, not after.

**Files:**

- Modify: `apps/desktop/src-tauri/Cargo.toml`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `apps/desktop/src-tauri/src/ports/kill.rs` (log the decisions)

**Interfaces:**

- Consumes: everything prior.
- Produces: `log::info!`/`warn!` visible in the `tauri dev` terminal and the webview console.

- [ ] **Step 1: Add the dependency**

In `Cargo.toml` `[dependencies]`:

```toml
tauri-plugin-log = "2"
```

- [ ] **Step 2: Register the plugin**

In `lib.rs`, add before `.plugin(tauri_plugin_opener::init())`:

```rust
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .build(),
        )
```

In `kill.rs`, at the top of `kill_port_impl` add:

```rust
    log::info!("kill_port requested: pid={pid} port={port} started_at={started_at}");
```

and before `Ok(escalate(pid))`:

```rust
    log::info!("kill_port guards passed for pid={pid}; escalating");
```

- [ ] **Step 3: Verify**

Run: `cd apps/desktop/src-tauri && cargo check && cargo test`
Expected: clean, all PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src-tauri
git commit -m "feat(desktop): wire tauri-plugin-log"
```
