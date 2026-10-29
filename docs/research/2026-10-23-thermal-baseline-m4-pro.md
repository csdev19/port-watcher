# Thermal baseline — MacBook Pro M4 Pro (2026-10-23, stress run 2026-10-24)

Evidence behind the System health thresholds in the
[v2 spec](../specs/2026-10-24-chapay-v2-design.md). One machine, one owner, on battery; read the
numbers as a calibration point, not as Apple specifications.

**Machine:** MacBook Pro `Mac16,8`, Apple M4 Pro, 12 cores (4 efficiency + 8 performance), 24 GB,
macOS 27.0.1. **Tools:** the [`examples/thermal-probe`](../../examples/thermal-probe) spike for the
2026-10-23 runs and the `chapay` CLI from `crates/system-health` for the 2026-10-24 run; no sudo.
Raw rows: `examples/thermal-probe/measurements/*/probe.csv`.

## What was measured

| Run           | Window                     | Conditions                                      |
| ------------- | -------------------------- | ----------------------------------------------- |
| Cool baseline | 3 min, every 5 s (37 rows) | battery 44 %, normal desktop apps, no local LLM |
| Idle, long    | 45 min (236 rows)          | same, no local LLM process ever seen            |
| CPU stress    | 25 s                       | 12 × `yes > /dev/null`, every core at ~100 %    |

## Results

| Metric                   | Cool baseline median | Cool baseline max   | CPU stress       |
| ------------------------ | -------------------- | ------------------- | ---------------- |
| CPU load                 | 7 %                  | 22 %                | 99.5 %           |
| GPU load                 | 4 %                  | 50 % (one sample)   | 4 %              |
| CPU hotspot (max sensor) | 51 °C                | 76 °C (short spike) | 77 °C            |
| GPU temperature          | ~47 °C               | 49 °C               | 56 °C            |
| System power (`PSTR`)    | 4.8 W                | 20 W                | 23 W             |
| Fan                      | 0 rpm                | 0 rpm               | 0 rpm (max 7826) |
| Thermal pressure         | nominal              | nominal             | nominal          |
| Swap used                | 3.2 GB               | 3.2 GB              | 3.2 GB           |

Over the 45-minute run: one WATCH sample (hotspot 81.6 °C), maximum 27.9 W, fan never spun, GPU up
to 66 %.

The `cpu_temp_avg` column in these CSVs is biased low: the probe version that recorded them still
averaged power-gated `Tp*` keys at 40.0 °C (about 46 °C instead of 51 °C on one snapshot). The
hotspot (`cpu_temp_max`) is unaffected. The probe in the repo has the fix.

## Sustained CPU stress (2026-10-24)

Run by the owner with the `chapay` CLI (`heat --watch 5 --csv` and `events --json` side by side):
30 s baseline, 12 busy loops for 300 s (17:55:52–18:00:58), then a 120 s cooldown. Raw data:
`examples/thermal-probe/measurements/2026-10-24-1754-cpu-stress/`: `probe.csv` (91 rows every
5 s), `events.jsonl`, `run.log` (the phase timestamps; the one-off driver script that wrote it was
not kept), `heat-start.txt` / `heat-peak.txt` / `heat-end.txt` (full `chapay heat` snapshots),
`heat-timeline.txt` (a snapshot every 16 s during the stress) and `sensors-start.txt` /
`sensors-peak.txt` (every SMC key with its classification). The `top` snapshot at start is not
committed (it names local apps); it showed only editors, Electron helpers and esbuild, no LLM
process. GPU load stayed between 0 and 11 % and memory (16.7–19.6 GB used, 3.7 GB swap, pressure
normal) never moved: **only the CPU was loaded**, so this run says nothing about the local-LLM case
(GPU plus memory). Power source and open apps were not recorded.

| Phase               | CPU hotspot                     | Thermal pressure       | Fan                                    | System power          |
| ------------------- | ------------------------------- | ---------------------- | -------------------------------------- | --------------------- |
| Baseline (30 s)     | 57–77 °C                        | nominal                | ~2,300 rpm (30 %)                      | 5–8 W                 |
| First 5 s of stress | 104 °C                          | nominal                | ~2,300 rpm                             | 51 W                  |
| Stress, 60 samples  | **mean 110.8 °C, max 115.2 °C** | **nominal throughout** | rising to 4,988 rpm (64 %) after ~70 s | mean 45 W, max 53.7 W |

- `events.jsonl` holds only the two initial levels: **no thermal or memory pressure transition
  fired** during five minutes with the hotspot above 104 °C.
- The fan lagged the temperature by more than a minute (2.3 krpm at idle, 30 %; 5.0 krpm at the
  peak, 64 %; back to 30 % about 90 s after the load stopped). On 2026-10-23 it never spun.
- The hotspot tracks power within one 5 s sample: 103.6 °C five seconds after the loops started,
  and from 110 °C down to 76 °C five seconds after they died. It behaves like die temperature, not
  like a slow chassis sensor. The hottest keys at the peak were `TpxD` and `Tp29` (110.6 °C), both
  performance cores; the GPU keys peaked at 81.6 °C with the GPU idle, heated by the CPU next to it.
- Sensor gating flips under load: at rest 51 of 83 `Tp*` keys read the power-gated 40.0 °C and are
  excluded; under load every core is awake, 134 keys are usable and `sensors_gated` is 0. The
  `sensors` dump at the peak still marked 51 performance-core keys implausible, so the filter also
  drops keys while the chip is hot; the hotspot comes from the usable ones.
- CPU load does not touch memory on this machine: used, compressed and swap stayed where the idle
  runs left them and memory pressure stayed normal. The Heat and Memory gauges are independent.
- The cooldown is **contaminated**: from 18:01 other agents started builds on the same machine, so
  the 100 % bursts after the stress window are not part of the experiment.

**Consequence:** [ADR 0011](../adr/0011-event-driven-background-signals-and-alerts.md)'s reopen
condition is met — thermal pressure stayed nominal while the hotspot passed 95 °C. A default STOP rule
on thermal pressure alone would not have fired. Whether 115 °C is a localized sensor the chip
tolerates is unknown; macOS did not throttle. The local-LLM (GPU + memory) case is still uncaptured.

## What it means for chapay

1. **Temperatures and watts need no privileged helper** on this machine: 243 SMC sensors and system
   power read from a plain user binary, and from an ad-hoc re-signed binary with hardened runtime.
   Not yet verified from the Developer ID signed, notarized app.
2. **High CPU % is not a heat danger by itself.** Every core at 100 % gave 77 °C with nominal thermal
   pressure and the fan off. A STOP threshold on CPU % would fire on every build.
3. **Memory is the tight resource at idle:** about 18 of 24 GB used, 6+ GB compressed, 3.2 GB swap
   that never moved. A swap-size rule would fire all the time; memory _pressure_ is the signal.
4. **The real overheating case is still not captured.** The owner reports heat when a local LLM
   (qwen) runs. The 2026-10-24 CPU stress showed that a 115 °C hotspot does not move thermal
   pressure, which is why ADR 0011 now adds a hotspot STOP rule (≥ 95 °C for 60 s) next to the
   pressure rule; the pressure rule itself has still never been seen firing. The pending GPU / LLM
   capture checks whether those two rules cover GPU-driven heat with a cool CPU. Procedure:
   `chapay events --json` and `chapay heat --watch 5 --csv` in the background, 30 s baseline, the
   load (LLM inference, or `yes > /dev/null` once per core), then a cooldown until the fan is back
   at idle; record the power source and the load command, and keep the machine otherwise quiet.
