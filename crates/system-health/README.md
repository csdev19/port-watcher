# system-health

Sudoless macOS system health for chapay: temperatures, CPU/GPU/memory load, thermal and memory
pressure, per-process attribution, and the `chapay` CLI. A pure Rust library (no Tauri) that the
desktop app depends on by path. Decisions: ADR 0009 (crate and CLI), 0010 (sources), 0011
(event-driven signals).

## Install and run

```sh
cargo install --path crates/system-health   # installs the `chapay` binary
chapay heat
```

Or without installing: `cargo run --release --manifest-path crates/system-health/Cargo.toml -- heat`.

## CLI

```
chapay heat    [--watch SECS] [--json | --csv] [--check]
chapay top     [-n N=10] [--sort cpu|mem|energy] [--interval MS=1000] [--watch SECS] [--json | --csv]
chapay sensors [--json] [--all]
chapay events  [--json]
chapay --version | --help
```

- `heat` prints one snapshot (it waits one second to measure CPU load). `--watch SECS` repeats
  every SECS seconds. `--check` exits 0 for OK, 1 for WATCH, 2 for STOP.
- `top` ranks your own processes. CPU% is per core (200 means two cores busy). Energy is an
  impact estimate in mW, not system watts. Other users' and root's processes are invisible
  without sudo. With `--watch SECS` the window between snapshots is SECS seconds.
- `sensors` lists SMC temperature keys with their group and validity (`power-gated` keys read
  exactly 40.0 C and are not real readings). `--all` includes battery and other keys.
- `events` prints the current thermal and memory pressure, then one line per change. It never
  polls: it blocks until the OS reports a change.
- `chapay ports` is reserved and exits 64 with "not available yet".
- Usage errors exit 64.

### JSON

`heat --json` prints one object per sample (NDJSON with `--watch`), camelCase: `takenAtMs`, `cpu`
(`totalPct`, per-core `cores`), `gpuPct`, `heat` (`cpuMaxC`, `cpuAvgC`, `gpuMaxC`, `sensorsUsed`,
`sensorsGated`), `fan`, `power`, `thermal`, `thermalRaw`, `memory`, and `verdict` (`level`, `reasons`).
A missing source is `null`. `top --json` prints an array of process usage. `events --json` prints
`{"at":..., "signal":"thermal"|"memory", "level":...}`.

### CSV

`heat --csv` writes the header once. The first 14 columns are the thermal-probe prototype's, in the
same order, so `examples/thermal-probe/scripts/hot-capture.sh` keeps working with them:

```
time,verdict,thermal,cpu_pct,gpu_pct,cpu_temp_avg,cpu_temp_max,gpu_temp_max,fan_rpm,fan_max_rpm,system_w,mem_used_gb,swap_gb,mem_free_pct
```

then `thermal_raw,mem_pressure,cpu_p_pct,cpu_e_pct,sensors_gated`. Two deliberate differences from
the prototype:

- `cpu_temp_avg` now excludes power-gated `Tp*` keys. Half of the 102 `Tp*` keys on an M4 Pro sit at
  exactly 40.0 C when idle and pulled the old average low (46.0 vs 50.9 C on the cool baseline).
  The maximum is unchanged.
- `thermal` uses `nominal|fair|serious|critical` instead of the prototype's
  `nominal|moderate|heavy|trapping|sleeping`; `thermal_raw` keeps the raw level.

The script itself still calls the prototype's flags (`--sensors`, `--watch 5 --csv`), so point it
at a wrapper or edit those calls to `chapay sensors` / `chapay heat --watch 5 --csv`.

## Verdict

STOP comes only from pressure signals: thermal pressure serious or critical, or memory pressure
critical. Temperature alone raises at most WATCH (hotspot at 80 C). A hotspot at 95 C is STOP only
when thermal pressure is unavailable. Swap at 4 GB and a fan above 50% while the machine is idle
are WATCH. CPU and GPU load never change the verdict. Thresholds are fixed defaults.

## Library

- `domain`: pure types and rules (sensor classification, heat aggregation, thresholds, verdict,
  pressure mapping, attribution). No I/O, no `unsafe`.
- `sampler`: the `Sources` trait and `Sampler`. `Sampler::sample()` never sleeps; the first call
  has `cpu: None` because a load needs two snapshots. `Sampler::top()` ranks processes since the
  previous call; each row carries the executable `path` and owner `uid` (cached per process
  incarnation), and `Sort::None` with `n = usize::MAX` returns every process in listing order.
- `infra` (macOS): SMC, IORegistry GPU, mach CPU and memory, sysctl, `proc_pid_rusage`. All
  `unsafe` lives here and in `events`. Every source degrades to `None`.
- `events` (macOS): `subscribe_thermal` and `subscribe_memory`.

### Subscription semantics

- Thermal: a notify file descriptor on `com.apple.system.thermalpressurelevel` plus one thread
  blocked in `poll(2)`. The callback runs only when the level changes.
- Memory: a `DISPATCH_SOURCE_TYPE_MEMORYPRESSURE` libdispatch source on a utility queue.
- Neither runs a timer. Callbacks are not invoked at subscribe time: read `current_thermal()` /
  `current_memory()` first.
- Dropping a `Subscription` cancels it and waits; no callback runs after `drop` returns. Do not
  drop it from inside its own callback.

## Tests

```sh
cargo test                       # pure tests, no hardware (what CI runs)
CHAPAY_HW_TESTS=1 cargo test     # also reads the real SMC, sysctl, libproc and notify on a Mac
```

Not covered by any test: a real thermal or memory pressure transition. Check memory by running
`chapay events` in one terminal and `sudo memory_pressure -S -l warn` in another: expect a
`memory warning` line, then `normal` when the simulation ends. Thermal needs a real overheating
capture (`chapay events --json` next to `hot-capture.sh`).

### Core order

`CoreKind` assumes `host_processor_info` lists the efficiency cores first. That is unverified. To
check: run four busy loops under `taskpolicy -b` (they run on efficiency cores) on an otherwise idle
Mac and look at `chapay heat --json | jq '.cpu.cores'`. If the busy cores are not indexes 0..3, fix
`infra::cpu::core_kind`; the safe fallback is `CoreKind::Unknown`.

## Limits

- SMC keys and IORegistry fields are undocumented and vary by chip and macOS release; the sensor
  table was verified on an M4 Pro only. Intel Macs may report no heat; the verdict then relies on
  pressure.
- The thermal level mapping (moderate to Fair, heavy to Serious, trapping/sleeping to Critical) is
  inferred.
- `ri_energy_nj` is shown as an impact estimate only and is never summed to watts.
- Reads inside the Developer ID signed, notarized app have not been verified yet (ADR 0010).
