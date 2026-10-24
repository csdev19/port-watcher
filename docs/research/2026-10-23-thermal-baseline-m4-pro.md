# Thermal baseline — MacBook Pro M4 Pro (2026-10-23)

Evidence behind the System health thresholds in the
[v2 spec](../specs/2026-10-24-chapay-v2-design.md). One machine, one owner, on battery; read the
numbers as a calibration point, not as Apple specifications.

**Machine:** MacBook Pro `Mac16,8`, Apple M4 Pro, 12 cores (4 efficiency + 8 performance), 24 GB,
macOS 27.0.1. **Tool:** [`examples/thermal-probe`](../../examples/thermal-probe), no sudo.
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

## What it means for chapay

1. **Temperatures and watts need no privileged helper** on this machine: 243 SMC sensors and system
   power read from a plain user binary, and from an ad-hoc re-signed binary with hardened runtime.
   Not yet verified from the Developer ID signed, notarized app.
2. **High CPU % is not a heat danger by itself.** Every core at 100 % gave 77 °C with nominal thermal
   pressure and the fan off. A STOP threshold on CPU % would fire on every build.
3. **Memory is the tight resource at idle:** about 18 of 24 GB used, 6+ GB compressed, 3.2 GB swap
   that never moved. A swap-size rule would fire all the time; memory _pressure_ is the signal.
4. **The real overheating case is not captured yet.** The owner reports heat when a local LLM (qwen)
   runs. Until that capture exists, the default STOP rule (thermal pressure) is unobserved; if
   pressure stays nominal while the hotspot passes 95 °C, the default changes to a hotspot rule.
