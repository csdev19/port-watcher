# Plan: temperature guard

Working document for [the spec](../specs/2026-11-04-temperature-guard-design.md) (NIW2-634).
The shipping PR deletes this file.

All paths below are under `apps/desktop/`. Rust checks: from `src-tauri/`,
`cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test`.
TypeScript checks: from `apps/desktop/`, `bun run check-types && bun run test`.

## Unit 0 — scaffolding (coordinator)

Dependencies in `src-tauri/Cargo.toml`: `rusqlite` (`bundled`), `chrono` (`clock`),
`tauri-plugin-notification`, and for macOS `objc2-foundation` (`NSProcessInfo`). Empty modules
`src-tauri/src/thermal/{mod,reading,store,sampler}.rs`, `mod thermal;` in `lib.rs`.

## Unit 1 — reading (Rust)

`thermal/reading.rs`: `ThermalState` (serde lowercase, ordered nominal < fair < serious <
critical, `as_i64`/`from_i64`), `ThermalBand` + `band_for(avg_c)`, `Reading { avg_c, max_c,
sensors, state, at_s }`, `summarize(&[(label, value)]) -> Option<(avg, max, count)>` (tdie
filter, 1–130 °C), `read_sensors()` over `sysinfo::Components`, `thermal_state()` via
`objc2-foundation` (non-macOS: nominal). Tests: -9201 °C dropped, no tdie → None, band edges,
state ordering and round trip.

## Unit 2 — store (Rust)

`thermal/store.rs`: `Store::open(path)` with WAL, schema v1 under `BEGIN IMMEDIATE` re-reading
`user_version`, move-aside (`thermal.sqlite.corrupt-<unix>` plus `-wal`/`-shm`) only for corrupt,
not-a-database or future version. Methods: `insert_bucket(&Bucket, local_day)` (also upserts
`days`), `upsert_peak(&Peak) -> id`, `prune(before_s)`, `buckets(from, to)`, `peaks(from, to)`,
`days(limit)`, `baseline(days) -> Option<f64>`. Tests on a temp dir: round trip, upsert of days,
prune cutoff keeps `days`, future version moved aside, garbage file moved aside, second open is a
no-op.

## Unit 3 — sampler, commands, wiring (Rust)

`thermal/sampler.rs`: pure `BucketAccumulator` (5-minute wall-clock buckets), pure `PeakPolicy`
(threshold 95 °C or ≥ serious, one row per 15 min, hotter updates) and `NotifyPolicy` (≥ serious,
once per 15 min); the background task (60 s, reads `thermalGuardEnabled` from `settings.json`,
top-5 processes by CPU with listening ports, retention daily). Commands `thermal_current`,
`thermal_history` in `commands.rs`; register plugin and commands in `lib.rs`. Tests for the pure
parts.

## Unit 4 — renderer (TypeScript)

`src/lib/types.ts` thermal types (spec contract), `src/lib/thermal.ts` (invoke wrappers, browser
mock), settings keys `thermalGuardEnabled`/`showTemperatureInPanel`, `src/settings/sections/
Thermal.tsx` (+ CSS, inline SVG chart), the tab in `Settings.tsx`, the opt-in header chip in
`App.tsx`. Tests: Thermal renders reading, band copy, peaks, unavailable state; chip absent by
default and no `thermal_current` call; chip present when on.

## Order

0 → (1 ∥ 2) → (3 ∥ 4) → review → proof → PR.
