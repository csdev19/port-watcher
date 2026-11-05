# ADR 0009: local history lives in a Rust-owned SQLite file

**Status:** accepted (2026-11-04); implemented on branch `feat/temperature-guard`, not on `main`
until that PR merges.
**Date:** 2026-11-04.
**Spec:** [docs/specs/2026-11-04-temperature-guard-design.md](../specs/2026-11-04-temperature-guard-design.md).

## Context

The desktop app stores only settings, in `settings.json` through `tauri-plugin-store`. The
temperature guard needs time-series history: about 288 bucket rows a day, kept 90 days, plus peaks
and daily summaries, queried by time range. ADR 0005 disabled the web app's Postgres database;
that decision is about the web Worker and does not cover the desktop app.

## Decision

The desktop app keeps its history in `<app_data_dir>/thermal.sqlite`, opened and written only by
Rust through `rusqlite` (feature `bundled`). The renderer reads it only through typed commands
(`thermal_history`); each command runs fixed, parameterized statements. Schema versions live in
`PRAGMA user_version` and follow the hub's
[local-store-migration](https://github.com/csdev19/general-knowledge/blob/main/architecture/local-store-migration.md)
rules: steps under `BEGIN IMMEDIATE`, move-aside only for corrupt, not-a-database or
future-version files.

## Alternatives rejected

- **`@tauri-apps/plugin-sql`.** The SQL string comes from the webview and the plugin has no
  transaction API ([hub](https://github.com/csdev19/general-knowledge/blob/main/desktop/tauri-architecture.md),
  option A).
- **JSON files through `tauri-plugin-store`.** Rewrites the whole file on every write and has no
  range queries; fine for settings, wrong for a time series.
- **One row per reading.** 1 440 rows a day for detail the 5-minute chart cannot show.
- **System SQLite instead of `bundled`.** Saves build time but ties behaviour to the macOS
  version's SQLite.

## Consequences

- A new native dependency (SQLite compiled from source) adds build time and binary size.
- Settings stay in `settings.json`; the database holds history only.
- A later feature that needs local history (for example NIW2-549's idle tracking) reuses this file
  and its migration path instead of adding a store.

## Non-goals

- Syncing or exporting the database.
- Moving settings into SQLite.

## What would reopen this

A second consumer of the data outside the Rust core (a CLI or another app), or a size problem
the retention window cannot solve.
