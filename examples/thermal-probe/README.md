# thermal-probe — spike for chapay's System health context

A zero-dependency Rust binary that reads, **without sudo**, what the Machine mode needs on Apple
Silicon: SMC temperatures, fan speed and system power (`PSTR`), GPU utilisation from
`IOAccelerator › PerformanceStatistics`, CPU load and memory from mach host statistics, and the
macOS thermal pressure level from `notify(3)`.

It is a **spike**, not product code. Phase 2 of the v2 plan
([spec](../../docs/specs/2026-10-24-chapay-v2-design.md)) ports it into `crates/system-health`.
Like `examples/kill-test-server`, it sits outside the `apps/*` / `packages/*` workspace globs, so it
never enters `build`, `test` or `check-types`.

## Use

```sh
cargo build --release
./target/release/thermal-probe                    # one snapshot with an OK / WATCH / STOP verdict
./target/release/thermal-probe --watch 5          # every 5 s
./target/release/thermal-probe --watch 5 --csv    # CSV rows for logging
./target/release/thermal-probe --sensors          # every SMC temperature sensor
./scripts/hot-capture.sh 10 hot                   # 10-minute capture of an overheating episode
```

`hot-capture.sh` writes to `measurements/<date-time>-<label>/`. Only `probe.csv` files are
committed: the process snapshots and sensor dumps name local paths and installed apps, so
`.gitignore` keeps them out of this public repository.

## Known sensor behaviour (M4 Pro)

- `Tp*` are performance cores. A power-gated core reads exactly `40.0` °C (some keys `~5` °C);
  those values are not temperatures and are excluded.
- `Te*` are efficiency cores, `Tg*` the GPU.
- The verdict's thresholds are rules of thumb; the authoritative signal is thermal pressure.

Measurements and what they mean: [docs/research/2026-10-23-thermal-baseline-m4-pro.md](../../docs/research/2026-10-23-thermal-baseline-m4-pro.md).
