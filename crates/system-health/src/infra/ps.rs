//! System and other users' processes through `/bin/ps`.
//!
//! `proc_pid_rusage` and `proc_pidinfo` fail with `EPERM` for every process of another user, so
//! root's and the system daemons' (`WindowServer`, `mds_stores`, ...) are invisible to libproc
//! without sudo. `/bin/ps` is setuid root with Apple's `com.apple.system-task-ports.read`
//! entitlement and prints them for anyone. It is the only external binary the crate runs
//! (ADR 0010): about 20 ms per call, so it belongs to the on-demand `top`, not to a background
//! loop. Its rows carry CPU time and RSS only: no start time, no physical footprint, no energy.
//! `kernel_task` (PID 0) is still missing: `ps` skips it and `top` costs 0.6 s per call.

use crate::domain::attribution::ProcessCounters;
use std::collections::HashSet;
use std::process::Command;

const PS: &str = "/bin/ps";
/// `comm` is last because it can contain spaces ("Linear Helper (Renderer)").
const COLUMNS: &str = "pid=,uid=,stat=,time=,rss=,%cpu=,comm=";

/// Counters for every process `ps` lists except those in `skip` (the ones libproc already read).
/// `None` when `ps` cannot run.
pub fn read_except(skip: &HashSet<u32>) -> Option<Vec<ProcessCounters>> {
    let text = run()?;
    Some(
        parse(&text)
            .into_iter()
            .filter(|p| !skip.contains(&p.pid))
            .collect(),
    )
}

/// Whether `ps` runs and lists at least `launchd` (PID 1), which belongs to root.
pub fn available() -> bool {
    run().is_some_and(|text| parse(&text).iter().any(|p| p.pid == 1))
}

fn run() -> Option<String> {
    let out = Command::new(PS)
        .env_clear()
        .args(["-Axo", COLUMNS])
        .output()
        .ok()?;
    out.status
        .success()
        .then(|| String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Parses `ps -Axo pid=,uid=,stat=,time=,rss=,%cpu=,comm=` output. Zombies and malformed lines
/// are dropped. `started_at` is 0 (unknown) and `footprint_bytes` is RSS.
pub fn parse(text: &str) -> Vec<ProcessCounters> {
    text.lines().filter_map(parse_line).collect()
}

fn parse_line(line: &str) -> Option<ProcessCounters> {
    let mut fields = line.split_whitespace();
    let pid: u32 = fields.next()?.parse().ok()?;
    let _uid: u32 = fields.next()?.parse().ok()?;
    let stat = fields.next()?;
    if stat.starts_with('Z') {
        return None;
    }
    let cpu_time_ns = parse_cpu_time(fields.next()?)?;
    let rss_kb: u64 = fields.next()?.parse().ok()?;
    let cpu_pct_hint: f32 = fields.next()?.parse().ok()?;
    let comm = fields.collect::<Vec<_>>().join(" ");
    if comm.is_empty() {
        return None;
    }
    Some(ProcessCounters {
        pid,
        name: comm.rsplit('/').next().unwrap_or(&comm).to_string(),
        started_at: 0,
        cpu_time_ns,
        footprint_bytes: rss_kb * 1024,
        energy_nj: None,
        cpu_pct_hint: Some(cpu_pct_hint),
    })
}

/// `[[dd-]hh:]mm:ss.cc` to nanoseconds. macOS keeps minutes unbounded (`346:47.37`), but the
/// day and hour forms are accepted too.
fn parse_cpu_time(s: &str) -> Option<u64> {
    let (days, rest) = match s.split_once('-') {
        Some((d, rest)) => (d.parse::<u64>().ok()?, rest),
        None => (0, s),
    };
    let mut parts: Vec<&str> = rest.split(':').collect();
    let seconds_part = parts.pop()?;
    let (secs, centis) = match seconds_part.split_once('.') {
        Some((s, c)) => (s.parse::<u64>().ok()?, c.parse::<u64>().ok()?),
        None => (seconds_part.parse::<u64>().ok()?, 0),
    };
    let (hours, minutes) = match parts.as_slice() {
        [m] => (0, m.parse::<u64>().ok()?),
        [h, m] => (h.parse::<u64>().ok()?, m.parse::<u64>().ok()?),
        _ => return None,
    };
    let total_centis = (((days * 24 + hours) * 60 + minutes) * 60 + secs) * 100 + centis;
    Some(total_centis * 10_000_000)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "\
    1     0 Ss    12:17.84  16688   0.4 /sbin/launchd
  400    88 Ss   346:47.37  87200  14.1 /System/Library/PrivateFrameworks/SkyLight.framework/Resources/WindowServer
 2030   501 S      3:21.90 198576   0.0 /Applications/Linear.app/Contents/Frameworks/Linear Helper (Renderer).app/Contents/MacOS/Linear Helper (Renderer)
 6133   501 ZN+    0:00.00      0   0.0 <defunct>
garbage line
";

    #[test]
    fn parses_rows_and_drops_zombies_and_garbage() {
        let rows = parse(SAMPLE);
        let pids: Vec<u32> = rows.iter().map(|p| p.pid).collect();
        assert_eq!(pids, [1, 400, 2030]);
    }

    #[test]
    fn row_fields() {
        let rows = parse(SAMPLE);
        let ws = &rows[1];
        assert_eq!(ws.name, "WindowServer");
        assert_eq!(ws.cpu_time_ns, ((346 * 60 + 47) * 100 + 37) * 10_000_000);
        assert_eq!(ws.footprint_bytes, 87200 * 1024);
        assert_eq!(ws.cpu_pct_hint, Some(14.1));
        assert_eq!(ws.energy_nj, None);
        assert_eq!(ws.started_at, 0);
    }

    #[test]
    fn command_names_keep_their_spaces() {
        assert_eq!(parse(SAMPLE)[2].name, "Linear Helper (Renderer)");
    }

    #[test]
    fn cpu_time_forms() {
        assert_eq!(parse_cpu_time("0:00.01"), Some(10_000_000));
        assert_eq!(parse_cpu_time("1:02.03"), Some((62 * 100 + 3) * 10_000_000));
        assert_eq!(parse_cpu_time("1:00:00"), Some(3600 * 1_000_000_000));
        assert_eq!(
            parse_cpu_time("2-01:00:00.50"),
            Some((49 * 3600 * 100 + 50) * 10_000_000)
        );
        assert_eq!(parse_cpu_time("abc"), None);
        assert_eq!(parse_cpu_time("1:2:3:4"), None);
    }

    #[test]
    fn skip_set_removes_pids() {
        let rows: Vec<_> = parse(SAMPLE)
            .into_iter()
            .filter(|p| !HashSet::from([1u32]).contains(&p.pid))
            .collect();
        assert_eq!(rows.len(), 2);
    }
}
