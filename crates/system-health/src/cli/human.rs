//! Human-readable output.

use crate::domain::{
    CoreKind, MachineInfo, ProcessUsage, Reading, Sample, SensorGroup, Validity, Verdict,
};

pub fn group_label(g: SensorGroup) -> &'static str {
    match g {
        SensorGroup::PerfCore => "perfCore",
        SensorGroup::EffCore => "effCore",
        SensorGroup::Gpu => "gpu",
        SensorGroup::Battery => "battery",
        SensorGroup::Other => "other",
    }
}

pub fn validity_label(v: Validity) -> &'static str {
    match v {
        Validity::Usable => "usable",
        Validity::PowerGated => "power-gated",
        Validity::Implausible => "implausible",
    }
}

fn opt(v: Option<f32>, unit: &str) -> String {
    v.map_or("n/a".into(), |x| format!("{x:.1}{unit}"))
}

pub fn heat_report(s: &Sample, v: &Verdict, machine: &MachineInfo) -> String {
    let mut out = format!("{:<14} {}\n", "verdict", v.level.tag());
    for r in &v.reasons {
        out.push_str(&format!("  - {}\n", r.describe()));
    }
    let mut body = String::new();
    let mut add = |label: &str, value: String| body.push_str(&format!("{label:<14} {value}\n"));
    add(
        "thermal",
        s.thermal.map_or("n/a", |t| t.label()).to_string(),
    );
    add("memory press.", s.memory.pressure.label().to_string());
    let cpu = match &s.cpu {
        Some(c) => {
            let split = match (
                c.kind_pct(CoreKind::Performance),
                c.kind_pct(CoreKind::Efficiency),
            ) {
                (Some(p), Some(e)) => format!(
                    "  (P {p:.0}%  E {e:.0}%  of {}P+{}E cores)",
                    machine.cores_p, machine.cores_e
                ),
                _ => String::new(),
            };
            format!("{:.1}%{split}", c.total_pct)
        }
        None => "n/a".into(),
    };
    add("cpu load", cpu);
    add(
        "gpu load",
        s.gpu_pct.map_or("n/a".into(), |g| format!("{g}%")),
    );
    match &s.heat {
        Some(h) => {
            add(
                "cpu temp",
                format!("avg {:.1} C  max {:.1} C", h.cpu_avg_c, h.cpu_max_c),
            );
            add("gpu temp", format!("max {}", opt(h.gpu_max_c, " C")));
            add(
                "sensors",
                format!("{} sensors ({} gated)", h.sensors_used, h.sensors_gated),
            );
        }
        None => {
            add("cpu temp", "n/a".into());
            add("gpu temp", "n/a".into());
        }
    }
    let fan = match &s.fan {
        Some(f) => match f.pct() {
            Some(p) => format!("{:.0} rpm ({p:.0}% of {:.0})", f.rpm, f.max_rpm),
            None => format!("{:.0} rpm", f.rpm),
        },
        None => "n/a".into(),
    };
    add("fan", fan);
    add(
        "system power",
        opt(s.power.as_ref().map(|p| p.system_w), " W"),
    );
    add(
        "memory",
        format!(
            "{:.1}/{:.0} GB used, {:.1} GB compressed, {:.1} GB swap, {}% free",
            s.memory.used_gb(),
            s.memory.total_gb(),
            s.memory.compressed_gb(),
            s.memory.swap_gb(),
            s.memory.free_pct
        ),
    );
    out.push_str(&body);
    out
}

pub fn top_table(rows: &[ProcessUsage], sort_label: &str) -> String {
    let mut out = format!(
        "{:>7}  {:>7}  {:>9}  {:>9}  {}\n",
        "PID", "CPU%", "MEM MB", "ENERGY mW", "NAME"
    );
    for u in rows {
        out.push_str(&format!(
            "{:>7}  {:>7.1}  {:>9.1}  {:>9}  {}\n",
            u.pid,
            u.cpu_pct,
            u.footprint_bytes as f64 / (1024.0 * 1024.0),
            u.energy_mw.map_or("-".to_string(), |e| format!("{e:.0}")),
            u.name
        ));
    }
    out.push_str(&format!(
        "sorted by {sort_label}. CPU% is per core (200 = two cores busy); energy is an impact estimate, not watts.\nOnly your own processes are listed: other users' and root's are invisible without sudo.\n"
    ));
    out
}

pub fn sensors_table(readings: &[Reading]) -> String {
    let mut out = String::new();
    for r in readings {
        out.push_str(&format!(
            "{}  {:<9} {:<12} {:.1} C\n",
            r.key.as_string(),
            group_label(r.group()),
            validity_label(r.validity()),
            r.celsius
        ));
    }
    out
}

pub fn event_line(at: &str, signal: &str, level: &str) -> String {
    format!("{at}  {signal:<8} {level}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{Level, SensorKey};

    #[test]
    fn sensors_table_lists_group_and_validity() {
        let r = [
            Reading {
                key: SensorKey::new("Tp01").unwrap(),
                celsius: 40.0,
            },
            Reading {
                key: SensorKey::new("Te01").unwrap(),
                celsius: 50.0,
            },
        ];
        let t = sensors_table(&r);
        assert!(t.contains("Tp01  perfCore  power-gated  40.0 C"), "{t}");
        assert!(t.contains("Te01  effCore   usable "), "{t}");
    }

    #[test]
    fn top_table_has_footer_and_dash_for_missing_energy() {
        let u = ProcessUsage {
            pid: 9,
            name: "x".into(),
            started_at: 0,
            cpu_pct: 1.0,
            footprint_bytes: 1048576,
            energy_mw: None,
            path: None,
            uid: None,
            gpu_pct: None,
        };
        let t = top_table(&[u], "cpu");
        assert!(t.contains("sudo"));
        assert!(t.lines().nth(1).unwrap().contains("-  x"));
    }

    #[test]
    fn level_tag_used_in_report() {
        assert_eq!(Level::Stop.tag(), "STOP");
    }
}
