//! The overall verdict. Pressure signals decide STOP; temperature alone raises at most WATCH
//! (owner decision D8), unless thermal pressure is unavailable.

use super::memory::MemoryPressure;
use super::sample::Sample;
use super::thermal::ThermalPressure;
use super::threshold::{Gauge, Thresholds};
use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Level {
    Ok,
    Watch,
    Stop,
}

impl Level {
    pub fn tag(self) -> &'static str {
        match self {
            Level::Ok => "OK",
            Level::Watch => "WATCH",
            Level::Stop => "STOP",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Reason {
    ThermalPressure(ThermalPressure),
    MemoryPressure(MemoryPressure),
    Hotspot {
        celsius: f32,
        limit: f32,
    },
    SwapHigh {
        swap_gb: f32,
    },
    FanWhileIdle {
        fan_pct: u8,
    },
    /// Neither sensors nor thermal pressure could be read. Informational: does not raise the level.
    SensorsUnavailable,
}

impl Reason {
    pub fn describe(&self) -> String {
        match self {
            Reason::ThermalPressure(p) => format!(
                "thermal pressure {} - macOS is limiting performance",
                p.label()
            ),
            Reason::MemoryPressure(p) => format!("memory pressure {}", p.label()),
            Reason::Hotspot { celsius, limit } => {
                format!("CPU hotspot {celsius:.0} C (>= {limit:.0})")
            }
            Reason::SwapHigh { swap_gb } => format!("{swap_gb:.1} GB of swap in use"),
            Reason::FanWhileIdle { fan_pct } => {
                format!("fan at {fan_pct}% while idle - possible dust/airflow issue")
            }
            Reason::SensorsUnavailable => {
                "temperature sensors and thermal pressure unavailable".into()
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Verdict {
    pub level: Level,
    pub reasons: Vec<Reason>,
}

pub fn evaluate(s: &Sample, t: &Thresholds) -> Verdict {
    let mut level = Level::Ok;
    let mut reasons = Vec::new();
    let mut raise = |to: Level, reason: Reason, level: &mut Level| {
        *level = (*level).max(to);
        reasons.push(reason);
    };

    match s.thermal {
        Some(p @ ThermalPressure::Fair) => {
            raise(Level::Watch, Reason::ThermalPressure(p), &mut level)
        }
        Some(p @ (ThermalPressure::Serious | ThermalPressure::Critical)) => {
            raise(Level::Stop, Reason::ThermalPressure(p), &mut level)
        }
        _ => {}
    }
    match s.memory.pressure {
        MemoryPressure::Warning => raise(
            Level::Watch,
            Reason::MemoryPressure(MemoryPressure::Warning),
            &mut level,
        ),
        MemoryPressure::Critical => raise(
            Level::Stop,
            Reason::MemoryPressure(MemoryPressure::Critical),
            &mut level,
        ),
        MemoryPressure::Normal => {}
    }
    if let Some(heat) = &s.heat {
        let hot = t.level(Gauge::Heat, heat.cpu_max_c);
        if hot >= Level::Watch {
            // Without thermal pressure to confirm, a hotspot past the stop limit is the only signal left.
            let to = if hot == Level::Stop && s.thermal.is_none() {
                Level::Stop
            } else {
                Level::Watch
            };
            let limit = if to == Level::Stop {
                t.hotspot_c.stop.unwrap_or(t.hotspot_c.warn)
            } else {
                t.hotspot_c.warn
            };
            raise(
                to,
                Reason::Hotspot {
                    celsius: heat.cpu_max_c,
                    limit,
                },
                &mut level,
            );
        }
    }
    let swap_gb = s.memory.swap_gb();
    if t.level(Gauge::Memory, swap_gb) >= Level::Watch {
        raise(Level::Watch, Reason::SwapHigh { swap_gb }, &mut level);
    }
    // Dust heuristic: the fan works hard while the machine is barely doing anything.
    if let (Some(fan), Some(cpu)) = (&s.fan, &s.cpu) {
        let idle = cpu.total_pct < 15.0
            && s.gpu_pct.unwrap_or(0) < 15
            && s.power.as_ref().is_none_or(|p| p.system_w < 15.0);
        if let Some(pct) = fan.pct().filter(|p| *p > 50.0 && idle) {
            raise(
                Level::Watch,
                Reason::FanWhileIdle {
                    fan_pct: pct.round() as u8,
                },
                &mut level,
            );
        }
    }
    if s.heat.is_none() && s.thermal.is_none() {
        reasons.push(Reason::SensorsUnavailable);
    }
    Verdict { level, reasons }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::cpu::CpuLoad;
    use crate::domain::heat::Heat;
    use crate::domain::memory::{GB, Memory};
    use crate::domain::sample::{Fan, Power};

    fn mem() -> Memory {
        Memory {
            total_bytes: (24.0 * GB) as u64,
            used_bytes: (17.0 * GB) as u64,
            compressed_bytes: 0,
            swap_bytes: (1.0 * GB) as u64,
            free_pct: 60,
            pressure: MemoryPressure::Normal,
        }
    }

    fn sample() -> Sample {
        Sample {
            taken_at_ms: 0,
            cpu: Some(CpuLoad {
                total_pct: 30.0,
                cores: vec![],
            }),
            gpu_pct: Some(3),
            heat: Some(Heat {
                cpu_max_c: 55.0,
                cpu_avg_c: 45.0,
                gpu_max_c: Some(48.0),
                sensors_used: 10,
                sensors_gated: 0,
            }),
            fan: Some(Fan {
                rpm: 0.0,
                max_rpm: 7800.0,
            }),
            power: Some(Power { system_w: 5.0 }),
            thermal: Some(ThermalPressure::Nominal),
            thermal_raw: Some(0),
            memory: mem(),
        }
    }

    fn eval(s: &Sample) -> Verdict {
        evaluate(s, &Thresholds::default())
    }

    #[test]
    fn cool_sample_is_ok() {
        let v = eval(&sample());
        assert_eq!(v.level, Level::Ok);
        assert!(v.reasons.is_empty());
    }

    #[test]
    fn thermal_pressure_mapping() {
        for (p, want) in [
            (ThermalPressure::Fair, Level::Watch),
            (ThermalPressure::Serious, Level::Stop),
            (ThermalPressure::Critical, Level::Stop),
        ] {
            let mut s = sample();
            s.thermal = Some(p);
            let v = eval(&s);
            assert_eq!(v.level, want);
            assert_eq!(v.reasons, [Reason::ThermalPressure(p)]);
        }
    }

    #[test]
    fn memory_pressure_mapping() {
        let mut s = sample();
        s.memory.pressure = MemoryPressure::Warning;
        assert_eq!(eval(&s).level, Level::Watch);
        s.memory.pressure = MemoryPressure::Critical;
        assert_eq!(eval(&s).level, Level::Stop);
    }

    #[test]
    fn hotspot_alone_is_at_most_watch_when_thermal_is_known() {
        let mut s = sample();
        s.heat.as_mut().unwrap().cpu_max_c = 79.0;
        assert_eq!(eval(&s).level, Level::Ok);
        s.heat.as_mut().unwrap().cpu_max_c = 82.0;
        assert_eq!(eval(&s).level, Level::Watch);
        s.heat.as_mut().unwrap().cpu_max_c = 99.0;
        let v = eval(&s);
        assert_eq!(v.level, Level::Watch);
        assert_eq!(
            v.reasons,
            [Reason::Hotspot {
                celsius: 99.0,
                limit: 80.0
            }]
        );
    }

    #[test]
    fn hotspot_past_95_is_stop_only_without_thermal_pressure() {
        let mut s = sample();
        s.thermal = None;
        s.thermal_raw = None;
        s.heat.as_mut().unwrap().cpu_max_c = 96.0;
        let v = eval(&s);
        assert_eq!(v.level, Level::Stop);
        assert_eq!(
            v.reasons,
            [Reason::Hotspot {
                celsius: 96.0,
                limit: 95.0
            }]
        );
        s.heat.as_mut().unwrap().cpu_max_c = 90.0;
        assert_eq!(eval(&s).level, Level::Watch);
    }

    #[test]
    fn swap_threshold() {
        let mut s = sample();
        s.memory.swap_bytes = (3.9 * GB as f64) as u64;
        assert_eq!(eval(&s).level, Level::Ok);
        s.memory.swap_bytes = (4.0 * GB as f64) as u64;
        assert_eq!(eval(&s).level, Level::Watch);
    }

    #[test]
    fn fan_while_idle() {
        let mut s = sample();
        s.cpu = Some(CpuLoad {
            total_pct: 5.0,
            cores: vec![],
        });
        s.fan = Some(Fan {
            rpm: 5000.0,
            max_rpm: 7800.0,
        });
        let v = eval(&s);
        assert_eq!(v.level, Level::Watch);
        assert_eq!(v.reasons, [Reason::FanWhileIdle { fan_pct: 64 }]);
        // Busy machine: a loud fan is expected.
        s.cpu = Some(CpuLoad {
            total_pct: 90.0,
            cores: vec![],
        });
        assert_eq!(eval(&s).level, Level::Ok);
        // Unknown load (first sample): no judgement.
        s.cpu = None;
        assert_eq!(eval(&s).level, Level::Ok);
    }

    #[test]
    fn cpu_and_gpu_load_never_raise_the_level() {
        let mut s = sample();
        s.cpu = Some(CpuLoad {
            total_pct: 100.0,
            cores: vec![],
        });
        s.gpu_pct = Some(100);
        assert_eq!(eval(&s).level, Level::Ok);
    }

    #[test]
    fn sensors_unavailable_only_when_heat_and_thermal_are_missing() {
        let mut s = sample();
        s.heat = None;
        assert!(!eval(&s).reasons.contains(&Reason::SensorsUnavailable));
        s.thermal = None;
        let v = eval(&s);
        assert!(v.reasons.contains(&Reason::SensorsUnavailable));
        assert_eq!(v.level, Level::Ok);
        let mut s = sample();
        s.thermal = None;
        assert!(!eval(&s).reasons.contains(&Reason::SensorsUnavailable));
    }

    #[test]
    fn cool_baseline_rows_are_all_ok() {
        let csv = include_str!("../../tests/fixtures/cool-baseline.csv");
        let mut rows = 0;
        for line in csv.lines().skip(1) {
            let c: Vec<&str> = line.split(',').collect();
            let f = |i: usize| c[i].parse::<f32>().ok();
            let mut s = sample();
            s.thermal = Some(ThermalPressure::Nominal);
            s.cpu = Some(CpuLoad {
                total_pct: f(3).unwrap(),
                cores: vec![],
            });
            s.gpu_pct = f(4).map(|v| v as u8);
            s.heat = Some(Heat {
                cpu_avg_c: f(5).unwrap(),
                cpu_max_c: f(6).unwrap(),
                gpu_max_c: f(7),
                sensors_used: 0,
                sensors_gated: 0,
            });
            s.fan = Some(Fan {
                rpm: f(8).unwrap(),
                max_rpm: f(9).unwrap(),
            });
            s.power = f(10).map(|w| Power { system_w: w });
            s.memory.used_bytes = (f(11).unwrap() * GB) as u64;
            s.memory.swap_bytes = (f(12).unwrap() * GB) as u64;
            s.memory.free_pct = f(13).unwrap() as u8;
            let v = eval(&s);
            assert_eq!(v.level, Level::Ok, "row {line} gave {:?}", v.reasons);
            rows += 1;
        }
        assert_eq!(rows, 37);
    }
}
