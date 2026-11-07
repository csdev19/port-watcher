//! The IPC types of the `memory_*` commands. Field names and string enums
//! are the contract the renderer codes against (spec "Commands and types",
//! mirrored in `src/lib/types.ts`), and the step that turns a raw
//! observation into the reading the Memory tab renders.

use std::collections::HashMap;
use std::path::Path;

use serde::Serialize;

use super::launchd::{self, Daemon, MemoryCommand};
use super::procs::{ProcInfo, ProcessReader, TOP_N};
use super::reading::{read_system, MemoryPressure, SystemMemory};
use super::store::{MemoryBucket, MemoryDay};
use super::topcmd::TopRow;
use super::verdict::{Evaluation, FirstSamples, MemorySignal, MemoryVerdict};
use crate::ports::classify::{classify_port, PortCategory};
use crate::ports::kill::{refusal, ProtectedReason};

/// What one tick looked at: the machine and its biggest processes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Observation {
    /// Epoch seconds.
    pub at_s: i64,
    pub system: SystemMemory,
    /// Biggest first, at most `TOP_N`.
    pub procs: Vec<ProcInfo>,
}

/// Reads the machine now. `top` is the cached `top` snapshot that fills in
/// the processes rusage cannot read. `None` when the system figures cannot
/// be read.
pub fn observe(reader: &mut ProcessReader, at_s: i64, top: &[TopRow]) -> Option<Observation> {
    let system = read_system()?;
    Some(Observation {
        at_s,
        system,
        procs: reader.top(TOP_N, top),
    })
}

/// Reads the machine now, like `observe`, and also lists every process
/// chapay can attribute. Only the on-demand read pays for the full list;
/// the observation still carries the top `TOP_N`, cut from the same pass.
pub fn observe_all(
    reader: &mut ProcessReader,
    at_s: i64,
    top: &[TopRow],
) -> Option<(Observation, Vec<ProcInfo>)> {
    let system = read_system()?;
    let all = reader.all(top);
    let procs = all.iter().take(TOP_N).cloned().collect();
    Some((
        Observation {
            at_s,
            system,
            procs,
        },
        all,
    ))
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryProcess {
    pub pid: u32,
    /// Epoch seconds; the PID-reuse guard, with the pid.
    pub started_at: u64,
    pub name: String,
    pub executable_path: Option<String>,
    pub user: Option<String>,
    /// `phys_footprint`, never RSS (ADR 0011).
    pub footprint_bytes: u64,
    /// The first retained sample of this incarnation, `null` if none.
    pub first_footprint_bytes: Option<u64>,
    pub first_sample_at: Option<i64>,
    /// A subset of `bigProcess` / `growing`.
    pub flags: Vec<MemorySignal>,
    /// The same policy as Ports: Rust decides, the renderer only renders it.
    pub killable: bool,
    /// Listening TCP ports, empty when none.
    pub ports: Vec<u16>,
    /// Why there is no Kill, `null` when killable.
    #[serde(rename = "protectedReason")]
    pub protected: Option<ProtectedReason>,
    /// Present only for another user's non-Apple process (ADR 0012, amended
    /// 2026-11-07).
    pub command: Option<MemoryCommand>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryReading {
    /// Epoch seconds.
    pub at: i64,
    pub total_bytes: u64,
    pub used_bytes: u64,
    pub compressed_bytes: u64,
    pub swap_used_bytes: u64,
    pub swap_total_bytes: u64,
    pub pressure: MemoryPressure,
    pub verdict: MemoryVerdict,
    /// Ordered as in the spec table.
    pub reasons: Vec<MemorySignal>,
    pub top: Vec<MemoryProcess>,
    /// Every process chapay can attribute, biggest first, built like `top`.
    pub processes: Vec<MemoryProcess>,
    /// `used_bytes` minus the processes' footprints: kernel wired memory,
    /// compressed pages of unknown owners and unreadable processes.
    pub unattributed_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryBucketDto {
    pub start_s: i64,
    pub used_avg_bytes: f64,
    pub used_max_bytes: u64,
    pub swap_avg_bytes: f64,
    pub swap_max_bytes: u64,
    pub worst_pressure: MemoryPressure,
    pub samples: i64,
}

impl From<MemoryBucket> for MemoryBucketDto {
    fn from(b: MemoryBucket) -> Self {
        MemoryBucketDto {
            start_s: b.start_s,
            used_avg_bytes: b.used_avg,
            used_max_bytes: b.used_max,
            swap_avg_bytes: b.swap_avg,
            swap_max_bytes: b.swap_max,
            worst_pressure: b.worst_pressure,
            samples: b.samples,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryDayDto {
    /// Local `YYYY-MM-DD`.
    pub day: String,
    pub swap_max_bytes: u64,
    pub used_max_bytes: u64,
    /// Minutes at pressure warning or worse.
    pub warning_minutes: i64,
}

impl From<MemoryDay> for MemoryDayDto {
    fn from(d: MemoryDay) -> Self {
        MemoryDayDto {
            day: d.day,
            swap_max_bytes: d.swap_max,
            used_max_bytes: d.used_max,
            warning_minutes: d.warning_minutes,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryHistory {
    /// False when the history store did not open.
    pub available: bool,
    pub buckets: Vec<MemoryBucketDto>,
    pub days: Vec<MemoryDayDto>,
}

impl MemoryHistory {
    pub fn unavailable() -> Self {
        MemoryHistory {
            available: false,
            buckets: Vec::new(),
            days: Vec::new(),
        }
    }
}

/// What the rows need from the live machine, apart from the observation:
/// who is running chapay, who listens where, and the launch daemons. Passed
/// in so `build_reading` has no side effects.
pub struct RowContext<'a> {
    pub my_uid: u32,
    pub self_pid: u32,
    /// Listening TCP ports by PID.
    pub ports: &'a HashMap<u32, Vec<u16>>,
    pub daemons: &'a [Daemon],
    pub user_name: &'a dyn Fn(u32) -> Option<String>,
}

/// One row, with the same policy for `top` and for the full list.
fn build_row(
    p: &ProcInfo,
    flags: Vec<MemorySignal>,
    first: &FirstSamples,
    ctx: &RowContext,
) -> MemoryProcess {
    let same_user = p.uid == Some(ctx.my_uid);
    let path = p.path.as_deref().map(Path::new);
    let category = classify_port(p.uid, ctx.my_uid, path);
    let protected = refusal(same_user, category, p.pid, ctx.self_pid);
    let user = p.uid.and_then(ctx.user_name);
    let first = first.get(&(p.pid, p.started_at));
    // The card is for another user's process whose binary is not Apple's:
    // `sudo kill` on an Apple system process harms the session (ADR 0012).
    let apple = classify_port(Some(ctx.my_uid), ctx.my_uid, path) == PortCategory::System;
    let command = (protected == Some(ProtectedReason::OtherUser) && !apple)
        .then(|| launchd::command_for(p.pid, p.path.as_deref(), user.as_deref(), ctx.daemons));
    MemoryProcess {
        pid: p.pid,
        started_at: p.started_at,
        name: p.name.clone(),
        executable_path: p.path.clone(),
        command,
        user,
        footprint_bytes: p.footprint_bytes,
        first_footprint_bytes: first.map(|f| f.footprint_bytes),
        first_sample_at: first.map(|f| f.at_s),
        flags,
        killable: protected.is_none(),
        protected,
        ports: ctx.ports.get(&p.pid).cloned().unwrap_or_default(),
    }
}

/// Assembles the reading the Memory tab renders from one observation and its
/// evaluation. `first` supplies each process's first retained sample; `all`
/// is every attributable process, biggest first (`observe_all`). Rows beyond
/// the top carry no flags: only the top is evaluated and sampled.
pub fn build_reading(
    obs: &Observation,
    all: &[ProcInfo],
    eval: &Evaluation,
    first: &FirstSamples,
    ctx: &RowContext,
) -> MemoryReading {
    let top = obs
        .procs
        .iter()
        .zip(&eval.flags)
        .map(|(p, flags)| build_row(p, flags.clone(), first, ctx))
        .collect();
    let flags_of: HashMap<(u32, u64), &Vec<MemorySignal>> = obs
        .procs
        .iter()
        .zip(&eval.flags)
        .map(|(p, f)| ((p.pid, p.started_at), f))
        .collect();
    let processes: Vec<MemoryProcess> = all
        .iter()
        .map(|p| {
            let flags = flags_of
                .get(&(p.pid, p.started_at))
                .map(|f| (*f).clone())
                .unwrap_or_default();
            build_row(p, flags, first, ctx)
        })
        .collect();
    let attributed: u64 = processes.iter().map(|p| p.footprint_bytes).sum();
    MemoryReading {
        at: obs.at_s,
        total_bytes: obs.system.total_bytes,
        used_bytes: obs.system.used_bytes,
        compressed_bytes: obs.system.compressed_bytes,
        swap_used_bytes: obs.system.swap_used_bytes,
        swap_total_bytes: obs.system.swap_total_bytes,
        pressure: obs.system.pressure,
        verdict: eval.verdict,
        reasons: eval.reasons.clone(),
        top,
        processes,
        unattributed_bytes: obs.system.used_bytes.saturating_sub(attributed),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::memory::verdict::{evaluate, FirstSample, MemoryThresholds, GIB};
    use serde_json::json;

    const ME: u32 = 501;
    const SELF_PID: u32 = 9000;

    fn proc(pid: u32, uid: u32, path: &str, footprint: u64) -> ProcInfo {
        ProcInfo {
            pid,
            started_at: 1_000 + u64::from(pid),
            name: path.rsplit('/').next().unwrap().to_owned(),
            path: Some(path.to_owned()),
            uid: Some(uid),
            footprint_bytes: footprint,
        }
    }

    fn observation(procs: Vec<ProcInfo>) -> Observation {
        Observation {
            at_s: 1_762_000_000,
            system: SystemMemory {
                total_bytes: 24 * GIB,
                used_bytes: 22 * GIB,
                compressed_bytes: 15 * GIB,
                swap_used_bytes: 19 * GIB,
                swap_total_bytes: 20 * GIB,
                pressure: MemoryPressure::Normal,
            },
            procs,
        }
    }

    fn user_name(uid: u32) -> Option<String> {
        Some(if uid == 0 { "root" } else { "cristian" }.to_owned())
    }

    #[test]
    fn rows_carry_killability_command_ports_and_first_sample() {
        let zdpd = proc(1101, 0, "/Library/Zscaler/zdpd", 16 * GIB);
        let node = proc(4242, ME, "/opt/homebrew/bin/node", GIB);
        let obs = observation(vec![zdpd, node]);
        let first: FirstSamples = HashMap::from([(
            (1101, 2101),
            FirstSample {
                footprint_bytes: 4 * GIB,
                at_s: 1_761_000_000,
            },
        )]);
        let eval = evaluate(
            &obs.system,
            &obs.procs,
            &MemoryThresholds::default(),
            &first,
        );
        let ports = HashMap::from([(4242, vec![5173, 5174])]);
        let ctx = RowContext {
            my_uid: ME,
            self_pid: SELF_PID,
            ports: &ports,
            daemons: &[],
            user_name: &user_name,
        };
        let reading = build_reading(&obs, &obs.procs, &eval, &first, &ctx);

        assert_eq!(reading.verdict, MemoryVerdict::Stop);
        let [zdpd, node] = reading.top.as_slice() else {
            panic!("two rows");
        };
        assert!(!zdpd.killable);
        let cmd = zdpd.command.as_ref().expect("a command for a root daemon");
        assert_eq!(cmd.text, "sudo kill 1101");
        assert_eq!(zdpd.user.as_deref(), Some("root"));
        assert_eq!(zdpd.first_footprint_bytes, Some(4 * GIB));
        assert_eq!(zdpd.first_sample_at, Some(1_761_000_000));
        assert_eq!(
            zdpd.flags,
            vec![MemorySignal::BigProcess, MemorySignal::Growing]
        );

        assert!(node.killable);
        assert!(node.command.is_none());
        assert_eq!(node.ports, vec![5173, 5174]);
        assert_eq!(node.first_footprint_bytes, None);
        assert_eq!(node.first_sample_at, None);
    }

    #[test]
    fn a_process_chapay_would_refuse_never_reads_as_killable() {
        let me_system = proc(300, ME, "/System/Library/CoreServices/Finder.app/x", GIB);
        let myself = proc(SELF_PID, ME, "/Applications/chapay.app/x", GIB);
        let low = proc(50, ME, "/opt/x", GIB);
        let unknown = ProcInfo {
            uid: None,
            path: None,
            ..proc(400, ME, "/x", GIB)
        };
        let obs = observation(vec![me_system, myself, low, unknown]);
        let eval = evaluate(
            &obs.system,
            &obs.procs,
            &MemoryThresholds::default(),
            &HashMap::new(),
        );
        let ports = HashMap::new();
        let ctx = RowContext {
            my_uid: ME,
            self_pid: SELF_PID,
            ports: &ports,
            daemons: &[],
            user_name: &user_name,
        };
        let reading = build_reading(&obs, &obs.procs, &eval, &HashMap::new(), &ctx);
        let reasons: Vec<_> = reading.top.iter().map(|r| r.protected).collect();
        assert_eq!(
            reasons,
            vec![
                Some(ProtectedReason::System),
                Some(ProtectedReason::SelfProcess),
                Some(ProtectedReason::LowPid),
                Some(ProtectedReason::OtherUser),
            ]
        );
        for row in &reading.top {
            assert!(!row.killable, "{}", row.name);
        }
        // Only the unknown-owner process, not Apple's, gets a command.
        let with_command: Vec<_> = reading
            .top
            .iter()
            .filter(|r| r.command.is_some())
            .map(|r| r.pid)
            .collect();
        assert_eq!(with_command, vec![400]);
    }

    #[test]
    fn an_apple_process_owned_by_the_user_is_protected_without_a_command() {
        let finder = proc(300, ME, "/System/Library/CoreServices/Finder.app/x", GIB);
        // Apple's binary under another user: still no `sudo kill` card.
        let root_apple = proc(301, 0, "/usr/libexec/something", GIB);
        let obs = observation(vec![finder, root_apple]);
        let eval = evaluate(
            &obs.system,
            &obs.procs,
            &MemoryThresholds::default(),
            &HashMap::new(),
        );
        let ports = HashMap::new();
        let ctx = RowContext {
            my_uid: ME,
            self_pid: SELF_PID,
            ports: &ports,
            daemons: &[],
            user_name: &user_name,
        };
        let reading = build_reading(&obs, &obs.procs, &eval, &HashMap::new(), &ctx);
        assert_eq!(reading.top[0].protected, Some(ProtectedReason::System));
        assert!(reading.top[0].command.is_none());
        assert_eq!(reading.top[1].protected, Some(ProtectedReason::OtherUser));
        assert!(reading.top[1].command.is_none());
        let v = serde_json::to_value(&reading.top[0]).unwrap();
        assert_eq!(v["protectedReason"], json!("system"));
        assert_eq!(v["command"], json!(null));
    }

    #[test]
    fn the_full_list_extends_top_and_the_rest_is_unattributed() {
        let procs: Vec<ProcInfo> = (0..10)
            .map(|i| {
                proc(
                    1000 + i,
                    ME,
                    &format!("/opt/p{i}"),
                    (10 - u64::from(i)) * GIB / 4,
                )
            })
            .collect();
        let mut obs = observation(procs.clone());
        obs.procs.truncate(8);
        let eval = evaluate(
            &obs.system,
            &obs.procs,
            &MemoryThresholds::default(),
            &HashMap::new(),
        );
        let ports = HashMap::new();
        let ctx = RowContext {
            my_uid: ME,
            self_pid: SELF_PID,
            ports: &ports,
            daemons: &[],
            user_name: &user_name,
        };
        let reading = build_reading(&obs, &procs, &eval, &HashMap::new(), &ctx);
        assert_eq!(reading.top.len(), 8);
        assert_eq!(reading.processes.len(), 10);
        let sum: u64 = procs.iter().map(|p| p.footprint_bytes).sum();
        assert_eq!(reading.unattributed_bytes, 22 * GIB - sum);
        // Never negative when processes add up to more than "used".
        let mut small = obs.clone();
        small.system.used_bytes = 1;
        let reading = build_reading(&small, &procs, &eval, &HashMap::new(), &ctx);
        assert_eq!(reading.unattributed_bytes, 0);
    }

    #[test]
    fn the_reading_serializes_with_the_contract_field_names() {
        let obs = observation(vec![proc(1101, 0, "/Library/Zscaler/zdpd", 16 * GIB)]);
        let eval = evaluate(
            &obs.system,
            &obs.procs,
            &MemoryThresholds::default(),
            &HashMap::new(),
        );
        let ports = HashMap::new();
        let ctx = RowContext {
            my_uid: ME,
            self_pid: SELF_PID,
            ports: &ports,
            daemons: &[],
            user_name: &user_name,
        };
        let v = serde_json::to_value(build_reading(
            &obs,
            &obs.procs,
            &eval,
            &HashMap::new(),
            &ctx,
        ))
        .unwrap();
        for key in [
            "at",
            "totalBytes",
            "usedBytes",
            "compressedBytes",
            "swapUsedBytes",
            "swapTotalBytes",
            "pressure",
            "verdict",
            "reasons",
            "top",
            "processes",
            "unattributedBytes",
        ] {
            assert!(v.get(key).is_some(), "missing {key}");
        }
        assert_eq!(v["pressure"], json!("normal"));
        assert_eq!(v["verdict"], json!("stop"));
        assert_eq!(v["reasons"], json!(["swap", "bigProcess"]));
        let row = &v["top"][0];
        for key in [
            "pid",
            "startedAt",
            "name",
            "executablePath",
            "user",
            "footprintBytes",
            "firstFootprintBytes",
            "firstSampleAt",
            "flags",
            "killable",
            "ports",
            "protectedReason",
            "command",
        ] {
            assert!(row.get(key).is_some(), "missing {key}");
        }
        assert_eq!(row["protectedReason"], json!("otherUser"));
        assert_eq!(row["firstFootprintBytes"], json!(null));
        assert_eq!(row["command"]["kind"], json!("kill"));
        assert_eq!(row["command"]["securityVendor"], json!("Zscaler"));
        assert_eq!(row["flags"], json!(["bigProcess"]));
    }

    #[test]
    fn history_serializes_with_the_contract_field_names() {
        let h = MemoryHistory {
            available: true,
            buckets: vec![MemoryBucket {
                start_s: 300,
                used_avg: 1.5,
                used_max: 2,
                swap_avg: 0.5,
                swap_max: 1,
                worst_pressure: MemoryPressure::Warning,
                samples: 5,
            }
            .into()],
            days: vec![MemoryDay {
                day: "2026-11-07".into(),
                swap_max: 9,
                used_max: 10,
                warning_minutes: 3,
            }
            .into()],
        };
        let v = serde_json::to_value(&h).unwrap();
        let b = &v["buckets"][0];
        for key in [
            "startS",
            "usedAvgBytes",
            "usedMaxBytes",
            "swapAvgBytes",
            "swapMaxBytes",
            "worstPressure",
            "samples",
        ] {
            assert!(b.get(key).is_some(), "missing {key}");
        }
        assert_eq!(b["worstPressure"], json!("warning"));
        let d = &v["days"][0];
        for key in ["day", "swapMaxBytes", "usedMaxBytes", "warningMinutes"] {
            assert!(d.get(key).is_some(), "missing {key}");
        }
        assert!(!MemoryHistory::unavailable().available);
    }
}
