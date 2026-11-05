# Temperature guard

**Status:** approved by the owner in the design conversation of 2026-11-04 (tracker NIW2-634).
Implemented on branch `feat/temperature-guard`; not on `main` until that PR merges.

## Summary (one minute)

chapay reads the Mac's SoC die temperature, explains what the number means, warns when macOS
reports thermal pressure, and keeps a local history in SQLite so the owner can see daily trends
and peaks. A peak records the busiest processes and marks the ones holding a listening port, so a
hot Mac can be traced to a dev server and killed from chapay. The panel's tabs become **Ports**
(Favourites as a collapsible section above the listening list) and **Thermal** (a compact view);
Settings gains a full **Thermal** tab with history. Showing the live temperature on the panel's
tab label is opt-in.

| #   | Decision                                                                                                                                                                                       | Why                                                                                                  | ADR        |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------- |
| 1   | Read sensors with `sysinfo` `Components` (already a dependency), average the `tdie` sensors, drop implausible values                                                                           | No sudo, ~60 ms on an M5, same sensors macmon and whirr use; one sensor reports -9201 °C             | —          |
| 2   | macOS `thermalState` drives warnings; °C bands are context labelled "community-reported"; a personal baseline appears once history exists                                                      | Apple publishes no die thresholds; `thermalState` is the only official pressure signal               | 0010 (new) |
| 3   | Sample every 60 s in the background, also while the panel is hidden, behind an on/off setting                                                                                                  | A guard that only measures while the panel is open misses every peak                                 | 0008 (new) |
| 4   | SQLite owned by Rust (`rusqlite`, bundled), fixed statements behind typed commands; 5-minute buckets, peak rows, daily summaries; buckets and peaks expire after 90 days, daily summaries stay | Rust owns storage as the hub recommends; buckets keep the shape of a day without one row per reading | 0009 (new) |
| 5   | A peak stores the top 5 processes by CPU over the last minute, with their listening ports                                                                                                      | The chapay-specific value: link heat to a killable dev server (absorbs part of NIW2-549)             | —          |
| 6   | Notify through `tauri-plugin-notification` when `thermalState` reaches serious or critical, at most once per 15 minutes                                                                        | The owner asked for a guard, not only a log                                                          | —          |
| 7   | Displayed value is the average of the `tdie` sensors; the hottest sensor is stored too                                                                                                         | Owner choice (B2); stable number, comparable with other tools                                        | —          |

## Open questions

- None blocking. Band edges (decision 2) and the peak threshold (95 °C hottest sensor) are
  community numbers; revisit after a month of the owner's own data.

## Out of scope

- Fan speeds, power draw, GPU-only sensors, battery health.
- Export of reports (the SQLite file stays readable in the app data folder).
- Automatic kills: the guard only reports and notifies.
- Intel Macs and other platforms: the reader returns "unavailable" and the UI says so.
- The RAM map script and the idle-dev-server alert of NIW2-549.

## Failures this must protect against

- A sensor returns garbage (-9201 °C, 0 °C, >150 °C): it must not reach the average or the DB.
- No `tdie` sensor exists (Intel, a future chip renaming them): the UI shows "unavailable", the
  sampler writes nothing, nothing crashes.
- The database file is corrupt, not a database, or from a newer schema: it is moved aside with a
  timestamp, logged, and a fresh one is created. Any other open error (busy, permission) disables
  history for the session without touching the file (hub: local-store-migration rule 6).
- Two chapay processes (dev build and installed app) open the same file: schema steps run under
  `BEGIN IMMEDIATE` and re-read the version (rule 7).
- The guard is turned off: the background sampler reads no sensor, writes nothing and sends no
  notification until it is turned on. (The Thermal tab and the opt-in chip still read the current
  temperature while they are open.)
- A dev build and the installed app run at once (same bundle id, same database): only the process
  holding `thermal.sampler.lock` samples, so nothing is written twice; the other retries the lock
  every tick and takes over when the holder quits.
- Weeks without data: the baseline and "last 7 days" use a calendar window ending today, not the
  last seven days on record.
- The Mac sleeps: the gap shows as missing buckets, not as zero-degree readings.
- Notification spam during a long hot build: one notification per 15 minutes at most.
- The panel stays as cheap as before while the Ports tab is open and the tab-label option is off:
  no thermal command runs.

## Acceptance criteria

- [ ] The panel's tabs are Ports and Thermal. Ports shows Favourites as a collapsible section
      (state remembered) above the listening list; arrow keys move through both as one list.
- [ ] The panel's Thermal tab shows the reading with its band and state, today's chart and today's
      peaks; clicking a peak's port switches to Ports filtered to that port.
- [ ] With `showTemperatureInPanel` on, the Thermal tab label shows the current temperature; with
      it off (the default) and the Ports tab open, the panel calls no thermal command.
- [ ] The Thermal tab shows the current average die temperature, its band label, the
      `thermalState`, and (once a day of history exists) the difference from the 7-day average.
- [ ] The Thermal tab shows today's chart from the 5-minute buckets, today's min/avg/max, the
      last 7 days' summaries, and the list of peaks with their top processes and ports.
- [ ] Readings outside 1–130 °C are discarded before averaging; a unit test covers -9201 °C.
- [ ] The sampler records with the panel hidden every 60 s while `thermalGuardEnabled` is on, and
      reads no sensor while it is off.
- [ ] Bucket and peak rows older than 90 days are deleted at startup and daily; daily summaries
      are kept. A unit test covers the cutoff.
- [ ] A notification fires when `thermalState` reaches serious or critical, at most once per
      15 minutes; a unit test covers the rate limit.
- [ ] The renderer reaches the database only through the `thermal_*` commands; no capability
      grants SQL access.

## Detail

### Reading

`thermal::sensors` reads `sysinfo::Components::new_with_refreshed_list()` (later refreshes reuse
the list). A sensor counts when its label contains `tdie` (case-insensitive) and its value is in
1–130 °C. `avg_c` is their mean, `max_c` their maximum. No valid sensor: the reading is `None`.

`thermal::state` reads `NSProcessInfo.processInfo.thermalState` through `objc2-foundation`
(macOS only; other targets return `Nominal`). Values: `nominal`, `fair`, `serious`, `critical`.

### Bands (context only, community-reported, on `avg_c`)

| Band         | Range     | Copy                                     |
| ------------ | --------- | ---------------------------------------- |
| `cool`       | < 50 °C   | Idle or light work                       |
| `normal`     | 50–70 °C  | Everyday work                            |
| `warm`       | 70–90 °C  | Sustained load: builds, video, many tabs |
| `hot`        | 90–100 °C | Heavy load, close to throttling          |
| `throttling` | ≥ 100 °C  | macOS slows the chip to cool it          |

Sources: owner measurements on an M5 (44–60 °C idle, 2026-11-04);
[Wccftech](https://wccftech.com/m5-macbook-pro-can-reach-99-degrees-celsius-when-under-load-but-runs-cooler-than-m4/),
[MacRumors](https://forums.macrumors.com/threads/mac-mini-m4-thermals.2442671/). The UI says the
bands are community-reported and that `thermalState` is what macOS itself reports.

### Sampler

A background task started in `setup`. Every 60 s: read `thermalGuardEnabled` from
`settings.json` (default `true`); if off, skip. Otherwise read sensors and state, refresh process
CPU usage (one long-lived `sysinfo::System`, CPU only, so usage covers the last minute), feed the
bucket accumulator, and evaluate the peak and notification rules.

- **Bucket:** 5 minutes aligned to wall clock. When a reading falls in a new bucket, the previous
  one is written: start, min/avg/max of `avg_c`, max of `max_c`, worst state, sample count. The
  same write upserts the local-date daily summary.
- **Peak:** `max_c ≥ 95` or state ≥ `serious`. At most one peak row per 15 minutes; within that
  window a hotter reading updates the row. The row stores the top 5 processes by CPU (pid, name,
  CPU %), each with the ports it listens on (from `ports::source::raw_ports`).
- **Notification:** state ≥ `serious`, at most once per 15 minutes. Title "Your Mac is running
  hot", body with the temperature and the top process with a port, if any.
- **Retention:** at startup and once a day, delete buckets and peaks older than 90 days.

### Storage

File: `<app_data_dir>/thermal.sqlite`, WAL mode. Schema version in `PRAGMA user_version`.

```sql
CREATE TABLE buckets (
  start_s INTEGER PRIMARY KEY,   -- epoch seconds, multiple of 300
  min_c REAL NOT NULL, avg_c REAL NOT NULL, max_avg_c REAL NOT NULL,
  max_c REAL NOT NULL,           -- hottest single sensor
  worst_state INTEGER NOT NULL,  -- 0 nominal .. 3 critical
  samples INTEGER NOT NULL
);
CREATE TABLE peaks (
  id INTEGER PRIMARY KEY,
  at_s INTEGER NOT NULL, avg_c REAL NOT NULL, max_c REAL NOT NULL,
  state INTEGER NOT NULL,
  processes TEXT NOT NULL        -- JSON array of {pid, name, cpu, ports}
);
CREATE INDEX peaks_at ON peaks(at_s);
CREATE TABLE days (
  day TEXT PRIMARY KEY,          -- local date YYYY-MM-DD
  min_c REAL NOT NULL, max_c REAL NOT NULL,
  sum_c REAL NOT NULL, samples INTEGER NOT NULL,
  serious_minutes INTEGER NOT NULL
);
```

Opening follows the hub's local-store-migration rules 6 and 7. A store that cannot open leaves
history unavailable; current readings still work.

### Commands and types (the contract the renderer codes against)

```ts
type ThermalState = "nominal" | "fair" | "serious" | "critical";
type ThermalBand = "cool" | "normal" | "warm" | "hot" | "throttling";
interface ThermalReading { avgC: number; maxC: number; sensors: number; state: ThermalState;
  band: ThermalBand; at: number /* epoch s */; baselineC: number | null /* 7-day avg */ }
interface ThermalBucket { startS: number; minC: number; avgC: number; maxAvgC: number;
  maxC: number; worstState: ThermalState; samples: number }
interface ThermalProcess { pid: number; name: string; cpu: number; ports: number[] }
interface ThermalPeak { id: number; atS: number; avgC: number; maxC: number;
  state: ThermalState; processes: ThermalProcess[] }
interface ThermalDay { day: string; minC: number; avgC: number; maxC: number;
  seriousMinutes: number }
interface ThermalHistory { available: boolean; buckets: ThermalBucket[]; peaks: ThermalPeak[];
  days: ThermalDay[] }
```

- `thermal_current() -> ThermalReading | null` — a fresh read (not the DB); `null` when no sensor.
- `thermal_history(from_s, to_s, days) -> ThermalHistory` — buckets and peaks in the range, plus
  the last `days` daily summaries. `available: false` when the store did not open.

### Settings

`thermalGuardEnabled: true` and `showTemperatureInPanel: false` join `SETTINGS_DEFAULTS`. The
Thermal tab holds both switches. The panel polls `thermal_current` every 10 s only while its
Thermal tab is open, or while the option is on (for the tab label) and the panel is visible.
`favouritesCollapsed: false` remembers the Favourites section's state.

### UI

- **Thermal tab** (Settings, icon `Thermometer`, between Ports and Permissions): the current
  reading large, band copy and `thermalState` below it, the baseline delta; today's chart as an
  inline SVG (average line, hottest-sensor line, band shading), today's min/avg/max; a 7-day list;
  the peak list (time, temperature, top processes, ports); the two switches.
- **Panel tabs:** `Ports` (count of listening ports) and `Thermal` (with the option on, the
  current `58°` coloured by band). The search field shows on Ports only.
- **Panel › Ports:** a `Favourites · N` header with a chevron that collapses the watched-ports
  section (form and rows), then the listening list. Search filters both; keyboard navigation and
  the kill shortcuts treat the visible favourite rows and listening rows as one list.
- **Panel › Thermal:** the reading and its band/state lines, today's chart (the same component as
  Settings), today's peaks (top processes, port pills). A port pill switches to Ports with the
  search set to that port. A footer link opens Settings › Thermal.

### References

- Hub: [desktop/tauri-architecture.md](https://github.com/csdev19/general-knowledge/blob/main/desktop/tauri-architecture.md) (Rust-owned storage),
  [architecture/local-store-migration.md](https://github.com/csdev19/general-knowledge/blob/main/architecture/local-store-migration.md).
- Prior art: [macmon](https://github.com/vladkens/macmon),
  [whirr hid_temp.rs](https://docs.rs/crate/whirr/0.3.4/source/src/mac/hid_temp.rs).
- Apple: [ProcessInfo.ThermalState](https://developer.apple.com/documentation/foundation/processinfo/thermalstate-swift.enum).
