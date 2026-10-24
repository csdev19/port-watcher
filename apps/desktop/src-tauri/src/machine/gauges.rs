//! Turns one `Sample` into the four gauges. Levels come from the crate's `Thresholds`; the
//! renderer never compares numbers. Two deliberate differences from `evaluate`:
//!
//! - Heat also goes to Stop when the hotspot passes its stop line, even if macOS still reports
//!   nominal thermal pressure. Measured on an M4 Pro: a 12-core stress put the hotspot at 115 C
//!   while pressure stayed nominal. The crate's verdict keeps its own rule (Watch only); the
//!   gauge shows the temperature honestly.
//! - Memory is coloured by macOS memory pressure, not by used percent (75 % used is normal).

use super::dto::{GaugeDto, GaugeId, GaugeUnit, HistoryPoint, VerdictDto};
use system_health::{
    Capabilities, Gauge, Level, MemoryPressure, Sample, ThermalPressure, Thresholds, Verdict,
};

/// The process driving CPU load right now, as a share of the whole machine.
#[derive(Debug, Clone, PartialEq)]
pub struct Culprit {
    pub name: String,
    pub cpu_pct: f32,
}

pub const HEAT_MIN_C: f32 = 30.0;
/// Above the 115 C seen in a stress run, so the sparkline does not clip.
pub const HEAT_MAX_C: f32 = 120.0;

fn pressure_level(p: ThermalPressure) -> Level {
    match p {
        ThermalPressure::Nominal => Level::Ok,
        ThermalPressure::Fair => Level::Watch,
        ThermalPressure::Serious | ThermalPressure::Critical => Level::Stop,
    }
}

fn pressure_word(p: ThermalPressure) -> &'static str {
    match p {
        ThermalPressure::Nominal => "Nominal",
        ThermalPressure::Fair => "Fair",
        ThermalPressure::Serious => "Serious",
        ThermalPressure::Critical => "Critical",
    }
}

fn pressure_index(p: ThermalPressure) -> u8 {
    match p {
        ThermalPressure::Nominal => 0,
        ThermalPressure::Fair => 1,
        ThermalPressure::Serious => 2,
        ThermalPressure::Critical => 3,
    }
}

/// The Heat gauge level: the worse of thermal pressure and the hotspot band.
pub fn heat_level(sample: &Sample, t: &Thresholds) -> Level {
    let by_pressure = sample.thermal.map_or(Level::Ok, pressure_level);
    let by_hotspot = sample
        .heat
        .as_ref()
        .map_or(Level::Ok, |h| t.level(Gauge::Heat, h.cpu_max_c));
    by_pressure.max(by_hotspot)
}

fn memory_level(p: MemoryPressure) -> Level {
    match p {
        MemoryPressure::Normal => Level::Ok,
        MemoryPressure::Warning => Level::Watch,
        MemoryPressure::Critical => Level::Stop,
    }
}

pub fn mem_used_pct(sample: &Sample) -> f32 {
    let m = &sample.memory;
    if m.total_bytes == 0 {
        0.0
    } else {
        (100.0 * m.used_bytes as f64 / m.total_bytes as f64) as f32
    }
}

fn unavailable(id: GaugeId, unit: GaugeUnit, max: f32, reason: &str) -> GaugeDto {
    GaugeDto {
        id,
        level: Level::Ok,
        value: "n/a".into(),
        extra: None,
        driver: reason.into(),
        warn: None,
        stop: None,
        min: 0.0,
        max,
        unit,
        available: false,
        unavailable_reason: Some(reason.into()),
    }
}

fn load_gauge(id: GaugeId, pct: f32, t: &Thresholds, which: Gauge, driver: String) -> GaugeDto {
    let band = t.band(which);
    GaugeDto {
        id,
        level: t.level(which, pct),
        value: format!("{pct:.0}%"),
        extra: None,
        driver,
        warn: Some(band.warn),
        stop: band.stop,
        min: 0.0,
        max: 100.0,
        unit: GaugeUnit::Percent,
        available: true,
        unavailable_reason: None,
    }
}

fn cpu_gauge(s: &Sample, t: &Thresholds, cores: u16, culprit: Option<&Culprit>) -> GaugeDto {
    let Some(cpu) = &s.cpu else {
        return unavailable(GaugeId::Cpu, GaugeUnit::Percent, 100.0, "Measuring…");
    };
    let driver = match culprit {
        Some(c) if c.cpu_pct >= 1.0 => format!("{} {:.0}% · {cores} cores", c.name, c.cpu_pct),
        _ => format!("{cores} cores"),
    };
    load_gauge(GaugeId::Cpu, cpu.total_pct, t, Gauge::Cpu, driver)
}

fn gpu_gauge(s: &Sample, t: &Thresholds, caps: &Capabilities) -> GaugeDto {
    match (caps.gpu, s.gpu_pct) {
        (true, Some(pct)) => {
            let driver = match s.heat.as_ref().and_then(|h| h.gpu_max_c) {
                Some(c) => format!("graphics load · {c:.0} °C"),
                None => "graphics load".into(),
            };
            load_gauge(GaugeId::Gpu, pct as f32, t, Gauge::Gpu, driver)
        }
        _ => unavailable(
            GaugeId::Gpu,
            GaugeUnit::Percent,
            100.0,
            "GPU load is not reported on this Mac",
        ),
    }
}

fn heat_gauge(s: &Sample, t: &Thresholds, caps: &Capabilities) -> GaugeDto {
    if s.thermal.is_none() && s.heat.is_none() {
        return unavailable(
            GaugeId::Heat,
            GaugeUnit::Level,
            3.0,
            "No temperature or thermal pressure reading on this Mac",
        );
    }
    let hotspot = s.heat.as_ref().map(|h| h.cpu_max_c);
    let level = heat_level(s, t);
    let (value, extra) = match (s.thermal, hotspot) {
        (Some(p), Some(c)) => (pressure_word(p).to_string(), Some(format!("{c:.0} °C"))),
        (Some(p), None) => (pressure_word(p).to_string(), None),
        (None, Some(c)) => (format!("{c:.0} °C"), None),
        (None, None) => unreachable!("checked above"),
    };
    let stop_line = t.hotspot_c.stop;
    let past_stop = matches!((hotspot, stop_line), (Some(c), Some(l)) if c >= l);
    // The pressure word and the hotspot both show on the gauge; the driver says what they mean.
    let driver = match (s.thermal, hotspot) {
        (Some(ThermalPressure::Nominal), Some(_)) if past_stop => {
            "Nominal pressure, but the hotspot is past the stop line".to_string()
        }
        (Some(p), Some(_)) => format!("{} pressure", pressure_word(p)),
        (Some(p), None) => format!("{} pressure · no temperature sensors", pressure_word(p)),
        (None, Some(_)) => "no thermal pressure reading".to_string(),
        (None, None) => String::new(),
    };
    // The sparkline is hotspot degrees when the SMC works, otherwise pressure steps 0 to 3.
    let (unit, min, max, warn, stop) = if caps.smc {
        (
            GaugeUnit::Celsius,
            HEAT_MIN_C,
            HEAT_MAX_C,
            Some(t.hotspot_c.warn),
            stop_line,
        )
    } else {
        (GaugeUnit::Level, 0.0, 3.0, None, None)
    };
    GaugeDto {
        id: GaugeId::Heat,
        level,
        value,
        extra,
        driver,
        warn,
        stop,
        min,
        max,
        unit,
        available: true,
        unavailable_reason: None,
    }
}

fn memory_gauge(s: &Sample) -> GaugeDto {
    let m = &s.memory;
    GaugeDto {
        id: GaugeId::Memory,
        level: memory_level(m.pressure),
        value: format!("{:.1} / {:.0} GB", m.used_gb(), m.total_gb()),
        extra: None,
        driver: format!(
            "{:.1} GB compressed · {:.1} GB swap",
            m.compressed_gb(),
            m.swap_gb()
        ),
        warn: None,
        stop: None,
        min: 0.0,
        max: 100.0,
        unit: GaugeUnit::Percent,
        available: true,
        unavailable_reason: None,
    }
}

/// CPU, GPU, Heat, Memory, in that order.
pub fn gauges(
    sample: &Sample,
    thresholds: &Thresholds,
    caps: &Capabilities,
    cores: u16,
    culprit: Option<&Culprit>,
) -> Vec<GaugeDto> {
    vec![
        cpu_gauge(sample, thresholds, cores, culprit),
        gpu_gauge(sample, thresholds, caps),
        heat_gauge(sample, thresholds, caps),
        memory_gauge(sample),
    ]
}

pub fn history_point(sample: &Sample) -> HistoryPoint {
    HistoryPoint {
        at_ms: sample.taken_at_ms,
        cpu: sample.cpu.as_ref().map(|c| c.total_pct),
        gpu: sample.gpu_pct.map(f32::from),
        heat: sample.heat.as_ref().map(|h| h.cpu_max_c),
        heat_level: sample.thermal.map(pressure_index),
        mem_used_pct: mem_used_pct(sample),
    }
}

pub fn verdict_dto(v: &Verdict) -> VerdictDto {
    VerdictDto {
        level: v.level,
        reasons: v.reasons.iter().map(|r| r.describe()).collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use system_health::{evaluate, CpuLoad, Heat, Memory};

    const GB: u64 = 1024 * 1024 * 1024;

    fn caps(smc: bool, gpu: bool) -> Capabilities {
        Capabilities {
            smc,
            sensors: 10,
            gpu,
            thermal: true,
            thermal_events: true,
            memory_events: true,
            system_power: false,
            per_process_energy: true,
        }
    }

    fn sample() -> Sample {
        Sample {
            taken_at_ms: 1000,
            cpu: Some(CpuLoad {
                total_pct: 34.0,
                cores: vec![],
            }),
            gpu_pct: Some(12),
            heat: Some(Heat {
                cpu_max_c: 71.0,
                cpu_avg_c: 60.0,
                gpu_max_c: Some(52.0),
                sensors_used: 10,
                sensors_gated: 0,
            }),
            fan: None,
            power: None,
            thermal: Some(ThermalPressure::Nominal),
            thermal_raw: Some(0),
            memory: Memory {
                total_bytes: 24 * GB,
                used_bytes: 18 * GB,
                compressed_bytes: 6 * GB,
                swap_bytes: 3 * GB,
                free_pct: 40,
                pressure: MemoryPressure::Normal,
            },
        }
    }

    fn run(s: &Sample, c: &Capabilities) -> Vec<GaugeDto> {
        gauges(s, &Thresholds::default(), c, 12, None)
    }

    fn by(id: GaugeId, g: &[GaugeDto]) -> &GaugeDto {
        g.iter().find(|x| x.id == id).unwrap()
    }

    #[test]
    fn four_gauges_in_order() {
        let g = run(&sample(), &caps(true, true));
        let ids: Vec<GaugeId> = g.iter().map(|x| x.id).collect();
        assert_eq!(
            ids,
            [GaugeId::Cpu, GaugeId::Gpu, GaugeId::Heat, GaugeId::Memory]
        );
    }

    #[test]
    fn cpu_and_gpu_levels_come_from_thresholds_and_stop_is_null() {
        let mut s = sample();
        s.cpu.as_mut().unwrap().total_pct = 85.0;
        s.gpu_pct = Some(95);
        let g = run(&s, &caps(true, true));
        let cpu = by(GaugeId::Cpu, &g);
        assert_eq!(cpu.level, Level::Watch);
        assert_eq!((cpu.warn, cpu.stop), (Some(80.0), None));
        assert_eq!(cpu.value, "85%");
        assert_eq!(by(GaugeId::Gpu, &g).level, Level::Watch);
        let ok = run(&sample(), &caps(true, true));
        assert_eq!(by(GaugeId::Cpu, &ok).level, Level::Ok);
    }

    #[test]
    fn cpu_driver_names_the_heaviest_process() {
        let c = Culprit {
            name: "Cursor Helper".into(),
            cpu_pct: 22.4,
        };
        let g = gauges(
            &sample(),
            &Thresholds::default(),
            &caps(true, true),
            12,
            Some(&c),
        );
        assert_eq!(by(GaugeId::Cpu, &g).driver, "Cursor Helper 22% · 12 cores");
    }

    #[test]
    fn first_sample_without_cpu_is_unavailable_not_zero() {
        let mut s = sample();
        s.cpu = None;
        let g = run(&s, &caps(true, true));
        let cpu = by(GaugeId::Cpu, &g);
        assert!(!cpu.available);
        assert_eq!(cpu.value, "n/a");
    }

    #[test]
    fn gpu_none_is_unavailable_with_a_reason() {
        let mut s = sample();
        s.gpu_pct = None;
        let g = run(&s, &caps(true, false));
        let gpu = by(GaugeId::Gpu, &g);
        assert!(!gpu.available);
        assert!(gpu.unavailable_reason.is_some());
    }

    #[test]
    fn heat_shows_pressure_word_and_hotspot_together() {
        let g = run(&sample(), &caps(true, true));
        let heat = by(GaugeId::Heat, &g);
        assert_eq!(heat.value, "Nominal");
        assert_eq!(heat.extra.as_deref(), Some("71 °C"));
        assert_eq!(heat.level, Level::Ok);
        assert_eq!(heat.unit, GaugeUnit::Celsius);
        assert_eq!((heat.warn, heat.stop), (Some(80.0), Some(95.0)));
    }

    #[test]
    fn hotspot_past_95_is_stop_even_when_pressure_is_nominal() {
        let mut s = sample();
        s.heat.as_mut().unwrap().cpu_max_c = 115.0;
        // The crate's verdict stays at Watch for this sample; the gauge must not.
        assert_eq!(evaluate(&s, &Thresholds::default()).level, Level::Watch);
        let g = run(&s, &caps(true, true));
        let heat = by(GaugeId::Heat, &g);
        assert_eq!(heat.level, Level::Stop);
        assert_eq!(heat.value, "Nominal");
        assert_eq!(heat.extra.as_deref(), Some("115 °C"));
        assert!(heat.driver.contains("past the stop line"));
    }

    #[test]
    fn hotspot_between_80_and_95_is_watch_and_pressure_can_raise_it() {
        let mut s = sample();
        s.heat.as_mut().unwrap().cpu_max_c = 85.0;
        assert_eq!(
            by(GaugeId::Heat, &run(&s, &caps(true, true))).level,
            Level::Watch
        );
        let mut s = sample();
        s.thermal = Some(ThermalPressure::Serious);
        assert_eq!(
            by(GaugeId::Heat, &run(&s, &caps(true, true))).level,
            Level::Stop
        );
        s.thermal = Some(ThermalPressure::Fair);
        assert_eq!(
            by(GaugeId::Heat, &run(&s, &caps(true, true))).level,
            Level::Watch
        );
    }

    #[test]
    fn heat_without_smc_is_a_step_series_with_no_lines() {
        let mut s = sample();
        s.heat = None;
        s.thermal = Some(ThermalPressure::Fair);
        let g = run(&s, &caps(false, true));
        let heat = by(GaugeId::Heat, &g);
        assert!(heat.available);
        assert_eq!(heat.unit, GaugeUnit::Level);
        assert_eq!((heat.warn, heat.stop), (None, None));
        assert_eq!((heat.min, heat.max), (0.0, 3.0));
        assert_eq!(heat.value, "Fair");
        assert_eq!(heat.level, Level::Watch);
    }

    #[test]
    fn heat_with_no_reading_at_all_is_unavailable() {
        let mut s = sample();
        s.heat = None;
        s.thermal = None;
        assert!(!by(GaugeId::Heat, &run(&s, &caps(false, true))).available);
    }

    #[test]
    fn memory_colour_follows_pressure_not_used_percent() {
        // 75 % used and nominal pressure: ok.
        let g = run(&sample(), &caps(true, true));
        let mem = by(GaugeId::Memory, &g);
        assert_eq!(mem.level, Level::Ok);
        assert_eq!(mem.value, "18.0 / 24 GB");
        assert_eq!(mem.driver, "6.0 GB compressed · 3.0 GB swap");
        assert_eq!((mem.warn, mem.stop), (None, None));
        let mut s = sample();
        s.memory.pressure = MemoryPressure::Warning;
        assert_eq!(
            by(GaugeId::Memory, &run(&s, &caps(true, true))).level,
            Level::Watch
        );
        s.memory.pressure = MemoryPressure::Critical;
        assert_eq!(
            by(GaugeId::Memory, &run(&s, &caps(true, true))).level,
            Level::Stop
        );
    }

    #[test]
    fn history_point_carries_the_series_values() {
        let p = history_point(&sample());
        assert_eq!(p.at_ms, 1000);
        assert_eq!(p.cpu, Some(34.0));
        assert_eq!(p.gpu, Some(12.0));
        assert_eq!(p.heat, Some(71.0));
        assert_eq!(p.heat_level, Some(0));
        assert_eq!(p.mem_used_pct, 75.0);
    }

    #[test]
    fn verdict_reasons_are_rendered_text() {
        let mut s = sample();
        s.thermal = Some(ThermalPressure::Serious);
        let v = verdict_dto(&evaluate(&s, &Thresholds::default()));
        assert_eq!(v.level, Level::Stop);
        assert!(v.reasons[0].contains("thermal pressure serious"));
    }
}
