//! CSV output. The first 14 columns are the thermal-probe prototype's, in the same order, so
//! `examples/thermal-probe/scripts/hot-capture.sh` keeps working. Extra columns go after them.

use crate::domain::{CoreKind, ProcessUsage, Sample, Verdict};

pub const HEAT_HEADER: &str = "time,verdict,thermal,cpu_pct,gpu_pct,cpu_temp_avg,cpu_temp_max,gpu_temp_max,fan_rpm,fan_max_rpm,system_w,mem_used_gb,swap_gb,mem_free_pct,thermal_raw,mem_pressure,cpu_p_pct,cpu_e_pct,sensors_gated";

fn f1(v: Option<f32>) -> String {
    v.map_or(String::new(), |x| format!("{x:.1}"))
}

/// `time` is already formatted (local time, `YYYY-MM-DDTHH:MM:SS`).
pub fn heat_row(time: &str, s: &Sample, v: &Verdict) -> String {
    let cpu = s.cpu.as_ref();
    let cols: Vec<String> = vec![
        time.to_string(),
        v.level.tag().to_string(),
        s.thermal.map_or("", |t| t.label()).to_string(),
        f1(cpu.map(|c| c.total_pct)),
        s.gpu_pct.map_or(String::new(), |g| g.to_string()),
        f1(s.heat.as_ref().map(|h| h.cpu_avg_c)),
        f1(s.heat.as_ref().map(|h| h.cpu_max_c)),
        f1(s.heat.as_ref().and_then(|h| h.gpu_max_c)),
        f1(s.fan.as_ref().map(|f| f.rpm)),
        f1(s.fan.as_ref().map(|f| f.max_rpm)),
        f1(s.power.as_ref().map(|p| p.system_w)),
        format!("{:.1}", s.memory.used_gb()),
        format!("{:.1}", s.memory.swap_gb()),
        s.memory.free_pct.to_string(),
        s.thermal_raw.map_or(String::new(), |r| r.to_string()),
        s.memory.pressure.label().to_string(),
        f1(cpu.and_then(|c| c.kind_pct(CoreKind::Performance))),
        f1(cpu.and_then(|c| c.kind_pct(CoreKind::Efficiency))),
        s.heat
            .as_ref()
            .map_or(String::new(), |h| h.sensors_gated.to_string()),
    ];
    cols.join(",")
}

pub const TOP_HEADER: &str = "time,pid,name,cpu_pct,mem_mb,energy_mw";

fn quote(s: &str) -> String {
    if s.contains([',', '"', '\n']) {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

pub fn top_rows(time: &str, rows: &[ProcessUsage]) -> Vec<String> {
    rows.iter()
        .map(|u| {
            format!(
                "{time},{},{},{:.1},{:.1},{}",
                u.pid,
                quote(&u.name),
                u.cpu_pct,
                u.footprint_bytes as f64 / (1024.0 * 1024.0),
                f1(u.energy_mw)
            )
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::memory::GB;
    use crate::domain::{
        CpuLoad, Fan, Heat, Level, Memory, MemoryPressure, Power, ThermalPressure,
    };

    const PROTOTYPE_14: &str = "time,verdict,thermal,cpu_pct,gpu_pct,cpu_temp_avg,cpu_temp_max,gpu_temp_max,fan_rpm,fan_max_rpm,system_w,mem_used_gb,swap_gb,mem_free_pct";

    fn sample() -> Sample {
        Sample {
            taken_at_ms: 0,
            cpu: Some(CpuLoad {
                total_pct: 8.6,
                cores: vec![],
            }),
            gpu_pct: Some(3),
            heat: Some(Heat {
                cpu_max_c: 52.1,
                cpu_avg_c: 41.3,
                gpu_max_c: Some(48.7),
                sensors_used: 60,
                sensors_gated: 51,
            }),
            fan: Some(Fan {
                rpm: 0.0,
                max_rpm: 7826.0,
            }),
            power: Some(Power { system_w: 4.8 }),
            thermal: Some(ThermalPressure::Nominal),
            thermal_raw: Some(0),
            memory: Memory {
                total_bytes: (24.0 * GB) as u64,
                used_bytes: (17.7 * GB) as u64,
                compressed_bytes: 0,
                swap_bytes: (3.2 * GB) as u64,
                free_pct: 61,
                pressure: MemoryPressure::Normal,
            },
        }
    }

    #[test]
    fn first_14_header_columns_match_the_prototype_byte_for_byte() {
        let first14: Vec<&str> = HEAT_HEADER.split(',').take(14).collect();
        assert_eq!(first14.join(","), PROTOTYPE_14);
        assert!(HEAT_HEADER.starts_with(PROTOTYPE_14));
        assert_eq!(HEAT_HEADER.split(',').count(), 19);
    }

    #[test]
    fn row_matches_the_prototype_format_and_has_one_value_per_column() {
        let v = Verdict {
            level: Level::Ok,
            reasons: vec![],
        };
        let row = heat_row("2026-10-23T22:24:42", &sample(), &v);
        assert_eq!(row.split(',').count(), HEAT_HEADER.split(',').count());
        assert!(
            row.starts_with(
                "2026-10-23T22:24:42,OK,nominal,8.6,3,41.3,52.1,48.7,0.0,7826.0,4.8,17.7,3.2,61,"
            ),
            "{row}"
        );
        assert!(row.ends_with(",0,normal,,,51"), "{row}");
    }

    #[test]
    fn missing_values_are_empty_cells() {
        let mut s = sample();
        s.cpu = None;
        s.heat = None;
        s.fan = None;
        s.power = None;
        s.thermal = None;
        s.thermal_raw = None;
        let v = Verdict {
            level: Level::Ok,
            reasons: vec![],
        };
        let row = heat_row("t", &s, &v);
        assert_eq!(row.split(',').count(), 19);
        assert!(row.starts_with("t,OK,,,3,,,,,,,17.7,3.2,61,"), "{row}");
    }

    #[test]
    fn top_rows_quote_names() {
        let u = ProcessUsage {
            pid: 1,
            name: "a,b".into(),
            started_at: 0,
            cpu_pct: 12.34,
            footprint_bytes: 2 * 1024 * 1024,
            energy_mw: None,
            path: None,
            uid: None,
            gpu_pct: None,
        };
        assert_eq!(top_rows("t", &[u]), ["t,1,\"a,b\",12.3,2.0,"]);
    }
}
