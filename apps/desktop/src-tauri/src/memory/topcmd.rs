//! The sudoless source for root daemons: `/usr/bin/top`.
//!
//! Why this exists. `proc_pid_rusage` (see `procs.rs`) fails with EPERM for
//! other users' processes unless the caller is root, and a few processes of
//! the same user are refused too. The process that motivated the memory guard
//! was a root daemon (`zdpd`, 16 GB), so rusage alone can never name it.
//! `/usr/bin/top` is setuid root and prints the same footprint Activity
//! Monitor does for every process, which makes it the only sudoless source.
//! chapay does not elevate anything: it runs the system binary as the user
//! and parses what it prints.
//!
//! Why it is rationed. One `top -l 1` costs about a second of CPU. Run once
//! per 5-minute bucket (the sampler's boundary) that is about 0.4 % of one
//! core, inside the 1 % budget of ADR 0008; run every 60 s it would be about
//! 1.8 %. So the result is cached, `proc_pid_rusage` still runs every tick,
//! and `snapshot` never starts `top` more than once per `MIN_INTERVAL_SECS`
//! from any caller (the sampler or the open tab).

use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

const TOP: &str = "/usr/bin/top";
/// How many rows `top` is asked for.
pub const TOP_ROWS: usize = 32;
/// `top` is never started more often than this, whoever asks.
pub const MIN_INTERVAL_SECS: i64 = 60;
/// A cached snapshot older than this is not merged: its PIDs may have been
/// reused and its footprints are stale.
pub const MAX_AGE_SECS: i64 = 600;
/// A hung `top` is killed after this long.
const TIMEOUT: Duration = Duration::from_secs(15);

/// One process as `top` reports it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TopRow {
    pub pid: u32,
    pub footprint_bytes: u64,
    /// `top` truncates the command to 16 characters.
    pub name: String,
}

/// `1827M`, `3648K+`, `114M-`, `16G`, `512B`: a number, a unit and the
/// optional `+`/`-` delta marker top prints on later samples.
fn parse_mem(token: &str) -> Option<u64> {
    let t = token.trim_end_matches(['+', '-']);
    let (num, unit) = match t.char_indices().last()? {
        (i, c) if c.is_ascii_alphabetic() => (&t[..i], c.to_ascii_uppercase()),
        _ => (t, 'B'),
    };
    let value: f64 = num
        .parse()
        .ok()
        .filter(|v: &f64| v.is_finite() && *v >= 0.0)?;
    let mult: f64 = match unit {
        'B' => 1.0,
        'K' => 1024.0,
        'M' => 1024.0 * 1024.0,
        'G' => 1024.0 * 1024.0 * 1024.0,
        'T' => 1024.0 * 1024.0 * 1024.0 * 1024.0,
        _ => return None,
    };
    Some((value * mult) as u64)
}

static LOGGED_SKIP: AtomicBool = AtomicBool::new(false);

/// The data rows of `top -stats pid,mem,command`: a PID, a size and the rest
/// of the line as the command. Header and summary lines, and anything else
/// unexpected, are skipped; the first one skipped after a PID-looking line is
/// logged once at debug.
pub fn parse(output: &str) -> Vec<TopRow> {
    let mut rows = Vec::new();
    for line in output.lines() {
        let mut parts = line.split_whitespace();
        let (Some(pid), Some(mem)) = (parts.next(), parts.next()) else {
            continue;
        };
        let name = parts.collect::<Vec<_>>().join(" ");
        match (pid.parse::<u32>(), parse_mem(mem)) {
            (Ok(pid), Some(footprint_bytes)) if pid > 0 && !name.is_empty() => {
                rows.push(TopRow {
                    pid,
                    footprint_bytes,
                    name,
                });
            }
            (Ok(_), _) if !LOGGED_SKIP.swap(true, Ordering::Relaxed) => {
                log::debug!("memory: top line not understood, skipped: {line:?}");
            }
            _ => {}
        }
    }
    rows
}

/// Runs `top` and returns its `n` biggest processes by memory. Fails when it
/// cannot start, times out, exits with an error, or prints nothing parseable.
pub fn read_top(n: usize) -> Result<Vec<TopRow>, String> {
    let mut child = Command::new(TOP)
        .args(["-l", "1", "-o", "mem", "-n", &n.to_string()])
        .args(["-stats", "pid,mem,command"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("could not start top: {e}"))?;
    let mut stdout = child.stdout.take().ok_or("top has no stdout")?;
    // Read on a thread so a hung `top` cannot block the timeout below.
    let reader = std::thread::spawn(move || {
        let mut buf = String::new();
        let _ = stdout.read_to_string(&mut buf);
        buf
    });
    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if started.elapsed() < TIMEOUT => {
                std::thread::sleep(Duration::from_millis(25));
            }
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("top timed out".into());
            }
            Err(e) => return Err(format!("could not wait for top: {e}")),
        }
    };
    let output = reader.join().map_err(|_| "top reader panicked")?;
    if !status.success() {
        return Err(format!("top exited with {status}"));
    }
    let rows = parse(&output);
    if rows.is_empty() {
        return Err("top printed no process rows".into());
    }
    Ok(rows)
}

/// The cached result of the last `top` run and when it was last tried.
#[derive(Default)]
pub struct TopCache {
    rows: Vec<TopRow>,
    /// Epoch seconds of the last successful run.
    read_at: Option<i64>,
    /// Epoch seconds of the last attempt, successful or not.
    tried_at: Option<i64>,
}

impl TopCache {
    /// The cached rows, refreshed first when `refresh` is set and the last
    /// attempt is at least `MIN_INTERVAL_SECS` old. Rows older than
    /// `MAX_AGE_SECS` are not returned. A failed run is logged, counts as an
    /// attempt (no retry storm) and keeps the previous rows.
    pub fn get(
        &mut self,
        now_s: i64,
        refresh: bool,
        read: impl FnOnce() -> Result<Vec<TopRow>, String>,
    ) -> Vec<TopRow> {
        let due = self.tried_at.is_none_or(|t| now_s - t >= MIN_INTERVAL_SECS);
        if refresh && due {
            self.tried_at = Some(now_s);
            match read() {
                Ok(rows) => {
                    self.rows = rows;
                    self.read_at = Some(now_s);
                }
                Err(e) => log::warn!("memory: top failed ({e}); root processes stay hidden"),
            }
        }
        match self.read_at {
            Some(t) if now_s - t <= MAX_AGE_SECS => self.rows.clone(),
            _ => Vec::new(),
        }
    }
}

static CACHE: Mutex<Option<TopCache>> = Mutex::new(None);

/// The process-wide cache: `refresh` asks for a new run (the sampler at a
/// bucket boundary, the open tab), which still happens at most once per
/// `MIN_INTERVAL_SECS` across all callers. The lock is held while `top` runs,
/// so two callers cannot start it together.
pub fn snapshot(now_s: i64, refresh: bool) -> Vec<TopRow> {
    let mut guard = CACHE.lock().unwrap_or_else(|e| e.into_inner());
    guard
        .get_or_insert_with(TopCache::default)
        .get(now_s, refresh, || read_top(TOP_ROWS))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    /// Captured from `top -l 1 -o mem -n 16 -stats pid,mem,command` on this
    /// machine (macOS 26), trimmed; the delta rows are what later samples of
    /// a multi-sample run print.
    const SAMPLE: &str = "\
Processes: 740 total, 7 running, 733 sleeping, 7637 threads 
2026/11/07 00:39:07
Load Avg: 9.32, 13.35, 10.16 
PhysMem: 23G used (3859M wired, 8768M compressor), 519M unused.
VM: 455T vsize, 6144M framework vsize, 27515227(0) swapins, 31488291(0) swapouts

PID    MEM   COMMAND         
1101   16G   zdpd            
12864  1827M com.apple.Virtua
64699  894M  Microsoft Teams 
404    3648K+ WindowServer    
77     114M- launchd
";

    #[test]
    fn parses_rows_with_suffixes_delta_markers_and_spaced_commands() {
        let rows = parse(SAMPLE);
        let got: Vec<_> = rows
            .iter()
            .map(|r| (r.pid, r.footprint_bytes, r.name.as_str()))
            .collect();
        assert_eq!(
            got,
            vec![
                (1101, 16 << 30, "zdpd"),
                (12864, 1827 << 20, "com.apple.Virtua"),
                (64699, 894 << 20, "Microsoft Teams"),
                (404, 3648 << 10, "WindowServer"),
                (77, 114 << 20, "launchd"),
            ]
        );
    }

    #[test]
    fn header_summary_and_garbage_lines_are_skipped_without_panicking() {
        let junk = "PID MEM COMMAND\n\n12 \n99 lots node\n-5 10M x\n0 10M kernel_task\n\
                    7 5M\n\u{0}\u{1} \u{2}\nabc 1M x\n42 2G ok proc\n";
        let rows = parse(junk);
        assert_eq!(
            rows,
            vec![TopRow {
                pid: 42,
                footprint_bytes: 2 << 30,
                name: "ok proc".into()
            }]
        );
        assert!(parse("").is_empty());
    }

    #[test]
    fn memory_tokens() {
        assert_eq!(parse_mem("512B"), Some(512));
        assert_eq!(parse_mem("512"), Some(512));
        assert_eq!(parse_mem("1.5G"), Some(3 << 29));
        assert_eq!(parse_mem("3648K+"), Some(3648 * 1024));
        assert_eq!(parse_mem("114M-"), Some(114 << 20));
        assert_eq!(parse_mem("16G"), Some(16 << 30));
        assert_eq!(parse_mem("12X"), None);
        assert_eq!(parse_mem(""), None);
        assert_eq!(parse_mem("+"), None);
        assert_eq!(parse_mem("-1M"), None);
    }

    fn row(pid: u32) -> TopRow {
        TopRow {
            pid,
            footprint_bytes: 1,
            name: "x".into(),
        }
    }

    #[test]
    fn top_runs_at_most_once_per_interval_whoever_asks() {
        let runs = Cell::new(0);
        let mut cache = TopCache::default();
        let mut ask = |now, refresh| {
            cache.get(now, refresh, || {
                runs.set(runs.get() + 1);
                Ok(vec![row(runs.get())])
            })
        };
        assert_eq!(ask(1000, true)[0].pid, 1);
        // Another caller inside the interval gets the cache, no new run.
        assert_eq!(ask(1000 + MIN_INTERVAL_SECS - 1, true)[0].pid, 1);
        // A caller that does not ask for a refresh never runs it.
        assert_eq!(ask(1000 + 200, false)[0].pid, 1);
        assert_eq!(runs.get(), 1);
        assert_eq!(ask(1000 + MIN_INTERVAL_SECS, true)[0].pid, 2);
        assert_eq!(runs.get(), 2);
    }

    #[test]
    fn a_failed_run_keeps_the_old_rows_and_is_not_retried_at_once() {
        let runs = Cell::new(0);
        let mut cache = TopCache::default();
        cache.get(1000, true, || Ok(vec![row(7)]));
        let rows = cache.get(1100, true, || {
            runs.set(runs.get() + 1);
            Err("boom".into())
        });
        assert_eq!(rows[0].pid, 7);
        cache.get(1110, true, || {
            runs.set(runs.get() + 1);
            Ok(vec![])
        });
        assert_eq!(runs.get(), 1, "the failure counted as an attempt");
    }

    #[test]
    fn stale_rows_are_not_returned() {
        let mut cache = TopCache::default();
        cache.get(1000, true, || Ok(vec![row(7)]));
        assert_eq!(
            cache
                .get(1000 + MAX_AGE_SECS, false, || unreachable!())
                .len(),
            1
        );
        assert!(cache
            .get(1000 + MAX_AGE_SECS + 1, false, || unreachable!())
            .is_empty());
    }

    /// Times one real `top` run. Run with
    /// `cargo test read_top_cost -- --ignored --nocapture`.
    #[test]
    #[ignore = "timing probe, runs /usr/bin/top"]
    fn read_top_cost_is_printed() {
        for i in 0..3 {
            let t = Instant::now();
            let rows = read_top(TOP_ROWS).expect("top runs");
            println!(
                "top {i}: {:?} wall, {} rows, biggest {} = {} MB",
                t.elapsed(),
                rows.len(),
                rows[0].name,
                rows[0].footprint_bytes >> 20
            );
        }
    }
}
