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

`hot-capture.sh` writes to `measurements/<date-time>-<label>/`. Probe rows (`probe.csv`), event
logs, `heat` snapshots, sensor dumps and run logs are committed; the process snapshots (`top*.txt`,
`start.txt`, `end.txt`) name local paths and installed apps, so `.gitignore` keeps them out of this
public repository.

## Measurements

| Folder                       | What                                                                 |
| ---------------------------- | -------------------------------------------------------------------- |
| `2026-10-23-cool-baseline`   | 3 min idle, this spike                                               |
| `2026-10-23-idle-45min`      | 45 min idle, this spike                                              |
| `2026-10-24-1754-cpu-stress` | 30 s baseline, 12 busy loops for 300 s, 120 s cooldown, `chapay` CLI |

The 2026-10-24 run was recorded with the `chapay` CLI from `crates/system-health`, not with this
spike: `chapay heat --watch 5 --csv` (`probe.csv`), `chapay events --json` (`events.jsonl`),
`chapay heat` snapshots (`heat-*.txt`) and `chapay sensors` dumps (`sensors-*.txt`). The driver
script that sequenced the phases was a one-off and was not kept; `run.log` records its timestamps.
To repeat it: start the two observers in the background, wait 30 s, run one `yes > /dev/null` per
core (12 on an M4 Pro) for the stress window, kill them, and keep observing until the fan is back at
idle. `crates/system-health/tests/rules_replay.rs` replays these CSVs through the alert rules, so a
new capture folder is a new test fixture. Findings:
[docs/research/2026-10-23-thermal-baseline-m4-pro.md](../../docs/research/2026-10-23-thermal-baseline-m4-pro.md).

## Known sensor behaviour (M4 Pro)

- `Tp*` are performance cores. A power-gated core reads exactly `40.0` °C (some keys `~5` °C);
  those values are not temperatures and are excluded.
- `Te*` are efficiency cores, `Tg*` the GPU.
- The verdict's thresholds are rules of thumb; the authoritative signal is thermal pressure.

Measurements and what they mean: [docs/research/2026-10-23-thermal-baseline-m4-pro.md](../../docs/research/2026-10-23-thermal-baseline-m4-pro.md).
