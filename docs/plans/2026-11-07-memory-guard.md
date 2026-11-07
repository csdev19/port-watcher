# Plan: memory guard (working document; the shipping PR deletes it)

Spec: `docs/specs/2026-11-07-memory-guard-design.md`. ADRs 0011, 0012. Branch `feat/memory-guard`
(worktree `.claude/worktrees/memory-guard`). Base: `origin/main` at `c82425a`.

Two implementers work in parallel on disjoint files; the IPC contract below is what joins them.
Pattern to copy, file by file: the temperature guard (`src-tauri/src/thermal/*`,
`src/components/ThermalPanel.tsx`, `src/hooks/use-thermal.ts`, `src/lib/thermal.ts`,
`src/settings/sections/Thermal.tsx`). Read those first; mirror their structure, naming, error
handling, tests and comments. Do not refactor them.

## IPC contract

Rust: `src-tauri/src/memory/api.rs` (serde camelCase). TS mirror: `src/lib/types.ts`.

```ts
export type MemoryPressure = "normal" | "warning" | "critical";
export type MemoryVerdict = "ok" | "watch" | "stop";
export type MemorySignal = "pressure" | "swap" | "bigProcess" | "growing";

export interface MemoryThresholds {
  swapWatchPct: number;        // default 80
  swapStopPct: number;         // default 95
  bigProcessPct: number;       // default 25 (% of physical RAM)
  growthFactor: number;        // default 2
  growthMinBytes: number;      // default 2 GiB
}

export interface MemoryProcess {
  pid: number;
  startedAt: number;           // epoch seconds; identity with pid
  name: string;
  executablePath: string | null;
  user: string | null;
  footprintBytes: number;      // phys_footprint
  firstFootprintBytes: number | null;  // first retained sample of this incarnation, null if none
  firstSampleAt: number | null;
  flags: MemorySignal[];       // subset of "bigProcess" | "growing"
  killable: boolean;           // is_killable, same policy as Ports
  ports: number[];             // listening ports, [] if none
  command: MemoryCommand | null;   // present only when !killable
}

export interface MemoryCommand {
  text: string;                // "sudo launchctl kickstart -k system/com.x.y" or "sudo kill 123"
  kind: "kickstart" | "kill";
  note: string;                // one line; ADR 0012
  securityVendor: string | null;
}

export interface MemoryReading {
  at: number;                  // epoch seconds
  totalBytes: number;
  usedBytes: number;           // app + wired + compressed (Activity Monitor)
  compressedBytes: number;
  swapUsedBytes: number;
  swapTotalBytes: number;
  pressure: MemoryPressure;
  verdict: MemoryVerdict;
  reasons: MemorySignal[];     // ordered as in the spec table
  top: MemoryProcess[];        // top 8 by footprint
}

export interface MemoryBucket {
  startS: number;
  usedAvgBytes: number; usedMaxBytes: number;
  swapAvgBytes: number; swapMaxBytes: number;
  worstPressure: MemoryPressure;
  samples: number;
}

export interface MemoryDay {
  day: string;                 // YYYY-MM-DD local
  swapMaxBytes: number; usedMaxBytes: number;
  warningMinutes: number;      // minutes at pressure >= warning
}

export interface MemoryHistory {
  available: boolean;
  buckets: MemoryBucket[];
  days: MemoryDay[];
}
```

Commands (`src-tauri/src/commands.rs`, registered in `lib.rs`):

- `memory_current() -> Option<MemoryReading>` — reads now (sysctl + mach + rusage), does not
  write; `None` when the system figures cannot be read.
- `memory_history(from_s, to_s, days) -> MemoryHistory`.
- `memory_thresholds() -> MemoryThresholds` and `set_memory_thresholds(t)` — stored in
  `settings.json` under `memoryThresholds` (tauri-plugin-store, like `thermalGuardEnabled`).
- Kill reuses `kill_port` when the row has a port; otherwise a new `kill_process(pid, started_at)`
  that runs the same guard chain (`ports::kill`'s `is_killable` + escalation) without the port
  check. Rust decides; the renderer only renders `killable`.

Settings keys (`src/settings/store.ts` defaults): `memoryGuardEnabled: true`,
`memoryThresholds: {80, 95, 25, 2, 2147483648}`.

## Slice R — Rust (`apps/desktop/src-tauri`)

Owner: implementer R. Files: `src/memory/{mod,api,reading,procs,launchd,verdict,store}.rs`,
`src/thermal/sampler.rs` (hook only), `src/thermal/store.rs` (schema step 2 only),
`src/commands.rs`, `src/lib.rs`, `src/settings.rs` (add "memory" section), `Cargo.toml` (`plist`
crate if needed for `launchd.rs`; prefer parsing with `plist = "1"`).

1. Port the readers from `origin/feat/chapay-v2` (read them with
   `git show origin/feat/chapay-v2:crates/system-health/src/infra/memory.rs`, same for
   `infra/procs.rs`, `infra/sysctl.rs`, `infra/ffi.rs`, `domain/memory.rs`). Keep only what
   `MemoryReading` needs: `host_statistics64`, `vm.swapusage`, `hw.memsize`,
   `kern.memorystatus_vm_pressure_level`, `proc_pid_rusage` (phys_footprint, flavor fallback V6→V4),
   `proc_listpids`, name/path. Put the FFI in `memory/reading.rs` and `memory/procs.rs`.
   Attribution comment: "ported from feat/chapay-v2 crates/system-health".
2. `verdict.rs`: pure functions `evaluate(reading, thresholds, first_samples) -> (verdict, reasons,
flags per process)`. Unit tests: each signal alone, STOP combination, PID reuse starts a fresh
   series, thresholds from settings override defaults.
3. `launchd.rs`: `label_for_executable(path) -> Option<String>` scanning
   `/Library/LaunchDaemons/*.plist` (`Program` or `ProgramArguments[0]` equals the path), and
   `command_for(process) -> MemoryCommand` with the vendor note (ADR 0012). Unit test with a temp
   dir of plists.
4. Store: schema step 2 in `thermal/store.rs` (never edit step 1):
   `memory_buckets(start_s PK, used_avg, used_max, swap_avg, swap_max, worst_pressure, samples)`,
   `memory_samples(pid, started_at, at_s, footprint, name, PK(pid, started_at, at_s))`,
   `memory_days(day PK, swap_max, used_max, warning_minutes)`. `prune` also deletes memory rows older
   than 90 days; `memory_days` is kept. First-sample lookup: `MIN(at_s)` per (pid, started_at).
5. Sampler hook in `thermal/sampler.rs`: inside the existing tick, after the thermal read, if
   `memoryGuardEnabled` (same `guard_enabled` pattern, key `memoryGuardEnabled`), read memory, write
   the bucket/samples/day, evaluate the verdict, and notify on STOP with its own 15-minute window.
   Keep the thermal path untouched when the memory guard is off. Log the tick's memory read cost at
   `debug` once per hour so the ADR 0008 budget can be checked.
6. Commands + registration + `settings.rs` section `"memory"`. `cargo fmt`, `cargo clippy -D
warnings`, `cargo test` in `apps/desktop/src-tauri`.

## Slice W — renderer (`apps/desktop/src`)

Owner: implementer W. Files: `src/lib/types.ts` (append the contract above), `src/lib/memory.ts`,
`src/hooks/use-memory.ts`, `src/components/MemoryPanel.tsx` + `memory-panel.module.css` +
`MemoryPanel.test.tsx`, `src/components/CommandCard.tsx`, `src/App.tsx` (third tab), `src/settings/
sections/Memory.tsx` + `memory.module.css` + `Memory.test.tsx`, `src/settings/Settings.tsx`,
`src/settings/store.ts`, `src/lib/mock-*.ts` if the panel has a browser mock mode (follow
`mock-ports.ts`).

1. Mirror `lib/thermal.ts`: `memoryCurrent()`, `memoryHistory()`, `memoryThresholds()`,
   `setMemoryThresholds()`, `killProcess()`, `formatBytes()`, `VERDICT_COPY`, `SIGNAL_COPY`,
   `todayRange` reuse. Tests for formatting and copy.
2. `use-memory.ts` mirrors `use-thermal.ts` (react-query, polls only while mounted; 10 s current,
   60 s history).
3. `MemoryPanel`: header line (verdict pill + reasons in words), figures row (used/total, swap
   used/total, compressed, pressure), then the top processes: name, footprint, flags as small
   pills ("big", "growing ×2.3 since 14:02"), ports as chips that call `onShowPort`, and either a
   Kill button wired to the existing `useKillConfirm` flow or the `CommandCard`. `CommandCard`:
   monospace command, Copy button (`navigator.clipboard`), the note, the vendor line when present.
   Visual language: same tokens and css modules as `ThermalPanel`; verdict colours reuse
   `bandColor`'s palette mapping (ok → mint, watch → yellow, stop → red).
4. `App.tsx`: `Tab = "ports" | "thermal" | "memory"`, label "Memory"; keyboard tab cycling and the
   "no command runs while Ports is active" rule hold. Update `App.test.tsx` expectations.
5. Settings › Memory: guard switch (`memoryGuardEnabled`), thresholds form (five numeric inputs
   with the defaults and a Reset), today's chart (reuse `ThermalChart` if its props allow two series;
   otherwise a sibling `MemoryChart` with the same look), 7-day summaries, current top processes.
   Register the section (`Settings.tsx`, icon `MemoryStick` from lucide).
6. `bun run test`, `bun run check-types` (build packages first:
   `bun run build --filter='@port-watcher/*'`).

## Integration (after both slices)

- Run `bun run dev:desktop` from the worktree and check the Memory tab shows the real machine
  (`zdpd` should appear in the top list; this machine has the evidence).
- Docs: `apps/documentation` page for the memory guard (mirror the temperature guard page);
  CLAUDE.md topology line for `src-tauri/src/memory/`.
- PR against `main` with `Refs #55`, NIW2-549; delete this plan in the shipping PR.
