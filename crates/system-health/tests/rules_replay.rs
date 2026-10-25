//! Replays the thermal-probe captures through the alert rules (ADR 0011). Idle captures must
//! never fire; the CPU stress capture must fire the hotspot STOP rule even though macOS kept
//! reporting nominal thermal pressure the whole time.

use std::time::{Duration, Instant};
use system_health::{
    HealthInput, HealthRuleId, HealthRules, HealthTransition, Level, MemoryPressure, Readings,
    ThermalPressure,
};

const COOL: &str =
    include_str!("../../../examples/thermal-probe/measurements/2026-10-23-cool-baseline/probe.csv");
const IDLE: &str =
    include_str!("../../../examples/thermal-probe/measurements/2026-10-23-idle-45min/probe.csv");
const STRESS: &str = include_str!(
    "../../../examples/thermal-probe/measurements/2026-10-24-1754-cpu-stress/probe.csv"
);

struct Row {
    at_s: u64,
    thermal: ThermalPressure,
    memory: MemoryPressure,
    readings: Readings,
}

fn seconds(ts: &str) -> u64 {
    // 2026-10-24T17:55:27: only the day and the clock matter inside one capture.
    let (date, clock) = ts.split_once('T').unwrap();
    let day: u64 = date.rsplit('-').next().unwrap().parse().unwrap();
    let mut it = clock.split(':').map(|v| v.parse::<u64>().unwrap());
    day * 86_400 + it.next().unwrap() * 3600 + it.next().unwrap() * 60 + it.next().unwrap()
}

fn thermal(word: &str) -> ThermalPressure {
    match word {
        "nominal" => ThermalPressure::Nominal,
        "fair" | "moderate" => ThermalPressure::Fair,
        "serious" | "heavy" => ThermalPressure::Serious,
        _ => ThermalPressure::Critical,
    }
}

fn rows(csv: &str) -> Vec<Row> {
    let mut lines = csv.lines();
    let header: Vec<&str> = lines.next().unwrap().split(',').collect();
    let col = |name: &str| header.iter().position(|h| *h == name);
    let (t, th, cpu, gpu, hot) = (
        col("time").unwrap(),
        col("thermal").unwrap(),
        col("cpu_pct").unwrap(),
        col("gpu_pct").unwrap(),
        col("cpu_temp_max").unwrap(),
    );
    let mem = col("mem_pressure");
    lines
        .map(|l| {
            let c: Vec<&str> = l.split(',').collect();
            Row {
                at_s: seconds(c[t]),
                thermal: thermal(c[th]),
                memory: match mem.map(|i| c[i]) {
                    Some("warning") => MemoryPressure::Warning,
                    Some("critical") => MemoryPressure::Critical,
                    _ => MemoryPressure::Normal,
                },
                readings: Readings {
                    cpu_pct: c[cpu].parse().ok(),
                    gpu_pct: c[gpu].parse().ok(),
                    hotspot_c: c[hot].parse().ok(),
                },
            }
        })
        .collect()
}

/// Feeds the rows like the app would: pressure as events (with the one-shot deadline), readings
/// at every `step_s` seconds.
fn replay(csv: &str, enabled: &[HealthRuleId], step_s: u64) -> Vec<(u64, HealthTransition)> {
    let rows = rows(csv);
    let base = Instant::now();
    let start = rows[0].at_s;
    let at = |s: u64| base + Duration::from_secs(s - start);
    let mut rules = HealthRules::new(enabled);
    let mut out = Vec::new();
    let (mut th, mut mem) = (None, None);
    let mut next_reading = start;
    for row in &rows {
        while let Some(d) = rules.next_deadline() {
            if d > at(row.at_s) {
                break;
            }
            let now_s = start + d.duration_since(base).as_secs();
            for t in rules.on_deadline((th, mem), d) {
                out.push((now_s, t));
            }
        }
        let now = at(row.at_s);
        if th != Some(row.thermal) {
            th = Some(row.thermal);
            out.extend(
                rules
                    .on_input(HealthInput::Thermal(row.thermal), now)
                    .into_iter()
                    .map(|t| (row.at_s, t)),
            );
        }
        if mem != Some(row.memory) {
            mem = Some(row.memory);
            out.extend(
                rules
                    .on_input(HealthInput::Memory(row.memory), now)
                    .into_iter()
                    .map(|t| (row.at_s, t)),
            );
        }
        if row.at_s >= next_reading {
            next_reading = row.at_s + step_s;
            out.extend(
                rules
                    .on_input(HealthInput::Readings(row.readings), now)
                    .into_iter()
                    .map(|t| (row.at_s, t)),
            );
        }
    }
    out
}

fn fired(v: &[(u64, HealthTransition)]) -> Vec<(u64, HealthRuleId, Level)> {
    v.iter()
        .filter_map(|(at, t)| match t {
            HealthTransition::Fired { rule, level, .. } => Some((*at, *rule, *level)),
            _ => None,
        })
        .collect()
}

#[test]
fn idle_captures_never_fire_even_with_every_rule_on() {
    for (name, csv) in [("cool", COOL), ("idle", IDLE)] {
        for step in [1, 30] {
            let all = replay(csv, &HealthRuleId::ALL, step);
            assert!(fired(&all).is_empty(), "{name} at {step}s fired: {all:?}");
            let defaults = replay(csv, &HealthRuleId::DEFAULT_ON, step);
            assert!(fired(&defaults).is_empty(), "{name} defaults fired");
        }
    }
}

#[test]
fn the_cpu_stress_capture_fires_the_hotspot_stop_rule() {
    for step in [1, 30] {
        let got = replay(STRESS, &HealthRuleId::DEFAULT_ON, step);
        let f = fired(&got);
        assert_eq!(
            f.iter().map(|(_, r, l)| (*r, *l)).collect::<Vec<_>>(),
            [(HealthRuleId::Hotspot, Level::Stop)],
            "step {step}: {got:?}"
        );
        // The stress started at 17:55:52 and the hotspot crossed 95 C by 17:56:08; it fires
        // about a minute later and well before the load stopped at 18:00:58.
        let at = f[0].0 % 86_400;
        assert!(
            (17 * 3600 + 56 * 60 + 50..=17 * 3600 + 58 * 60 + 30).contains(&at),
            "fired at {at}"
        );
    }
}
