//! "Top by CPU": every process from one walk, grouped by app bundle and ranked by summed CPU.
//!
//! A row's kill button signals exactly one process (ADR 0006 lists bulk kill as a non-goal):
//! the bundle's main process when it is among the processes, otherwise the heaviest member.
//! `killable` and `lock_reason` come from the same policy as the ports list.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use system_health::ProcessUsage;

use super::dto::{KillTarget, LockReason, MemberDto, ProcessGroupDto};
use crate::ports::classify::{app_bundle_path, classify_port, PortCategory};
use crate::ports::kill::{is_killable, static_guard};

pub struct GroupContext<'a> {
    pub my_uid: u32,
    pub self_pid: u32,
    /// Logical cores. Per-process CPU arrives per core (100 = one core busy); the panel shows
    /// it as a share of the whole machine, the same scale as the CPU gauge.
    pub cores: u16,
    pub home: Option<&'a str>,
    pub limit: usize,
}

struct Member<'a> {
    usage: &'a ProcessUsage,
}

fn bundle_label(bundle: &Path) -> String {
    bundle
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("app")
        .to_string()
}

/// `/Users/me/dev/bin` becomes `~/dev/bin`.
fn tildify(dir: &Path, home: Option<&str>) -> String {
    let text = dir.to_string_lossy();
    match home {
        Some(h) if !h.is_empty() && h != "/" => match text.strip_prefix(h) {
            Some("") => "~".into(),
            Some(rest) if rest.starts_with('/') => format!("~{rest}"),
            _ => text.into_owned(),
        },
        _ => text.into_owned(),
    }
}

fn is_main_of(path: &str, bundle: &Path) -> bool {
    Path::new(path)
        .parent()
        .is_some_and(|dir| dir == bundle.join("Contents").join("MacOS"))
}

fn heavier(a: &ProcessUsage, b: &ProcessUsage) -> std::cmp::Ordering {
    a.cpu_pct
        .total_cmp(&b.cpu_pct)
        .then(a.footprint_bytes.cmp(&b.footprint_bytes))
        .then(b.pid.cmp(&a.pid))
}

fn lock_reason(u: &ProcessUsage, ctx: &GroupContext) -> Option<LockReason> {
    if u.pid == ctx.self_pid {
        return Some(LockReason::SelfProcess);
    }
    let exe = u.path.as_deref().map(Path::new);
    let category = classify_port(u.uid, ctx.my_uid, exe);
    if u.uid != Some(ctx.my_uid) {
        return Some(LockReason::OtherUser);
    }
    if category == PortCategory::System || static_guard(u.pid, ctx.self_pid).is_some() {
        return Some(LockReason::System);
    }
    None
}

pub fn group(all: &[ProcessUsage], ctx: &GroupContext) -> Vec<ProcessGroupDto> {
    let cores = f32::from(ctx.cores.max(1));
    // Keep first-seen order so equal rows stay stable.
    let mut order: Vec<String> = Vec::new();
    let mut groups: HashMap<String, (Option<PathBuf>, Vec<Member>)> = HashMap::new();
    for usage in all {
        let bundle = usage
            .path
            .as_deref()
            .and_then(|p| app_bundle_path(Path::new(p)));
        let key = match &bundle {
            Some(b) => b.to_string_lossy().into_owned(),
            None => format!("{}:{}", usage.pid, usage.started_at),
        };
        groups
            .entry(key.clone())
            .or_insert_with(|| {
                order.push(key.clone());
                (bundle.clone(), Vec::new())
            })
            .1
            .push(Member { usage });
    }

    let mut rows: Vec<ProcessGroupDto> = order
        .into_iter()
        .map(|key| {
            let (bundle, members) = groups.remove(&key).expect("key came from order");
            let heaviest = members
                .iter()
                .map(|m| m.usage)
                .max_by(|a, b| heavier(a, b))
                .expect("a group has a member");
            let main = bundle.as_ref().and_then(|b| {
                members
                    .iter()
                    .map(|m| m.usage)
                    .filter(|u| u.path.as_deref().is_some_and(|p| is_main_of(p, b)))
                    .min_by_key(|u| u.started_at)
            });
            let target = main.unwrap_or(heaviest);
            let cpu_pct = members.iter().map(|m| m.usage.cpu_pct).sum::<f32>() / cores;
            let mem_bytes = members.iter().map(|m| m.usage.footprint_bytes).sum();
            let n = members.len();
            let sub = match &bundle {
                Some(b) => format!(
                    "{} · {} process{}",
                    bundle_label(b),
                    n,
                    if n == 1 { "" } else { "es" }
                ),
                None => heaviest
                    .path
                    .as_deref()
                    .and_then(|p| Path::new(p).parent())
                    .map(|d| tildify(d, ctx.home))
                    .unwrap_or_default(),
            };
            let exe = target.path.as_deref().map(Path::new);
            let killable = is_killable(
                target.uid == Some(ctx.my_uid),
                classify_port(target.uid, ctx.my_uid, exe),
                target.pid,
                ctx.self_pid,
            );
            let lock = if killable {
                None
            } else {
                lock_reason(target, ctx).or(Some(LockReason::System))
            };
            ProcessGroupDto {
                key,
                name: heaviest.name.clone(),
                sub,
                cpu_pct,
                mem_bytes,
                member_count: n as u32,
                target: Some(KillTarget {
                    pid: target.pid,
                    started_at: target.started_at,
                }),
                target_is_main: main.is_some(),
                target_name: target.name.clone(),
                killable,
                lock_reason: lock,
                gpu_pct: members
                    .iter()
                    .filter_map(|m| m.usage.gpu_pct)
                    .reduce(|a, b| a + b)
                    .map(|g| g.min(100.0)),
                members: members
                    .iter()
                    .map(|m| MemberDto {
                        pid: m.usage.pid,
                        started_at: m.usage.started_at,
                    })
                    .collect(),
            }
        })
        .collect();
    rows.sort_by(|a, b| {
        b.cpu_pct
            .total_cmp(&a.cpu_pct)
            .then(b.mem_bytes.cmp(&a.mem_bytes))
    });
    rows.truncate(ctx.limit);
    rows
}

#[cfg(test)]
mod tests {
    use super::*;

    const ME: u32 = 501;
    const SELF_PID: u32 = 9000;
    const CURSOR: &str = "/Applications/Cursor.app";

    fn p(pid: u32, name: &str, path: &str, cpu: f32, mem: u64) -> ProcessUsage {
        ProcessUsage {
            pid,
            name: name.into(),
            started_at: 1000 + u64::from(pid),
            cpu_pct: cpu,
            footprint_bytes: mem,
            energy_mw: None,
            path: Some(path.into()),
            uid: Some(ME),
            gpu_pct: None,
        }
    }

    fn renderer(pid: u32, cpu: f32) -> ProcessUsage {
        p(
            pid,
            "Cursor Helper (Renderer)",
            &format!("{CURSOR}/Contents/Frameworks/Cursor Helper (Renderer).app/Contents/MacOS/Cursor Helper (Renderer)"),
            cpu,
            100,
        )
    }

    fn main_proc(pid: u32, cpu: f32) -> ProcessUsage {
        p(
            pid,
            "Cursor",
            &format!("{CURSOR}/Contents/MacOS/Cursor"),
            cpu,
            50,
        )
    }

    fn ctx(limit: usize) -> GroupContext<'static> {
        GroupContext {
            my_uid: ME,
            self_pid: SELF_PID,
            cores: 12,
            home: Some("/Users/me"),
            limit,
        }
    }

    #[test]
    fn electron_helpers_group_under_the_app_bundle() {
        let rows = group(
            &[
                renderer(200, 60.0),
                renderer(201, 60.0),
                main_proc(199, 12.0),
            ],
            &ctx(5),
        );
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].key, CURSOR);
        assert_eq!(rows[0].member_count, 3);
        assert_eq!(rows[0].sub, "Cursor · 3 processes");
        // 132 % of one core on a 12-core machine is 11 % of the machine.
        assert!((rows[0].cpu_pct - 11.0).abs() < 1e-4);
        assert_eq!(rows[0].mem_bytes, 250);
        assert_eq!(rows[0].name, "Cursor Helper (Renderer)");
    }

    #[test]
    fn the_main_process_is_the_kill_target() {
        let rows = group(&[renderer(200, 90.0), main_proc(199, 1.0)], &ctx(5));
        let t = rows[0].target.unwrap();
        assert_eq!(t.pid, 199);
        assert_eq!(t.started_at, 1199);
        assert!(rows[0].target_is_main);
        assert_eq!(rows[0].target_name, "Cursor");
        assert_eq!(rows[0].name, "Cursor Helper (Renderer)");
        assert!(rows[0].killable);
        assert_eq!(rows[0].lock_reason, None);
    }

    #[test]
    fn without_a_main_process_the_heaviest_member_is_the_target() {
        let rows = group(&[renderer(200, 10.0), renderer(201, 80.0)], &ctx(5));
        assert_eq!(rows[0].target.unwrap().pid, 201);
        assert!(!rows[0].target_is_main);
    }

    #[test]
    fn a_process_outside_a_bundle_stays_single() {
        let rows = group(
            &[
                p(
                    300,
                    "node",
                    "/Users/me/dev/app/node_modules/.bin/node",
                    100.0,
                    5,
                ),
                p(
                    301,
                    "node",
                    "/Users/me/dev/app/node_modules/.bin/node",
                    100.0,
                    5,
                ),
            ],
            &ctx(5),
        );
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].member_count, 1);
        assert_eq!(rows[0].sub, "~/dev/app/node_modules/.bin");
        assert!(rows[0].killable);
    }

    #[test]
    fn system_paths_are_locked_as_system() {
        let rows = group(
            &[p(
                400,
                "Finder",
                "/System/Library/CoreServices/Finder.app/Contents/MacOS/Finder",
                5.0,
                1,
            )],
            &ctx(5),
        );
        assert!(!rows[0].killable);
        assert_eq!(rows[0].lock_reason, Some(LockReason::System));
    }

    #[test]
    fn another_users_process_is_locked_as_other_user() {
        let mut other = p(500, "mds", "/usr/sbin/thing", 5.0, 1);
        other.uid = Some(0);
        let mut unknown = p(501, "x", "/opt/x", 4.0, 1);
        unknown.uid = None;
        let rows = group(&[other, unknown], &ctx(5));
        assert!(rows.iter().all(|r| !r.killable));
        assert!(rows
            .iter()
            .all(|r| r.lock_reason == Some(LockReason::OtherUser)));
    }

    #[test]
    fn our_own_process_is_locked_as_self() {
        let rows = group(
            &[p(
                SELF_PID,
                "chapay",
                "/Applications/chapay.app/Contents/MacOS/chapay",
                1.0,
                1,
            )],
            &ctx(5),
        );
        assert!(!rows[0].killable);
        assert_eq!(rows[0].lock_reason, Some(LockReason::SelfProcess));
    }

    #[test]
    fn low_pids_are_locked() {
        let rows = group(&[p(50, "launchd-ish", "/opt/x", 1.0, 1)], &ctx(5));
        assert!(!rows[0].killable);
        assert_eq!(rows[0].lock_reason, Some(LockReason::System));
    }

    #[test]
    fn sums_and_ranking_use_the_summed_cpu_then_limit() {
        let rows = group(
            &[
                p(300, "a", "/opt/a", 120.0, 1),
                renderer(200, 70.0),
                renderer(201, 70.0),
                p(302, "c", "/opt/c", 30.0, 1),
            ],
            &ctx(2),
        );
        assert_eq!(rows.len(), 2);
        // Cursor: 140 % of one core, a: 120 %.
        assert_eq!(rows[0].key, CURSOR);
        assert_eq!(rows[1].name, "a");
        assert!((rows[1].cpu_pct - 10.0).abs() < 1e-4);
    }

    #[test]
    fn zero_cores_does_not_divide_by_zero() {
        let mut c = ctx(5);
        c.cores = 0;
        let rows = group(&[p(300, "a", "/opt/a", 50.0, 1)], &c);
        assert_eq!(rows[0].cpu_pct, 50.0);
    }

    #[test]
    fn tilde_only_replaces_a_whole_home_prefix() {
        assert_eq!(tildify(Path::new("/Users/me"), Some("/Users/me")), "~");
        assert_eq!(
            tildify(Path::new("/Users/mexico/x"), Some("/Users/me")),
            "/Users/mexico/x"
        );
        assert_eq!(tildify(Path::new("/opt/x"), None), "/opt/x");
    }

    #[test]
    fn group_gpu_is_the_sum_of_members_and_none_when_nobody_reports() {
        let mut a = main_proc(1, 5.0);
        let mut b = renderer(2, 5.0);
        let rows = group(&[a.clone(), b.clone()], &ctx(10));
        assert_eq!(rows[0].gpu_pct, None);
        a.gpu_pct = Some(10.0);
        b.gpu_pct = Some(2.5);
        let rows = group(&[a, b], &ctx(10));
        assert_eq!(rows[0].gpu_pct, Some(12.5));
    }

    #[test]
    fn group_lists_every_member_by_pid_and_start() {
        let rows = group(&[main_proc(1, 5.0), renderer(2, 5.0)], &ctx(10));
        let members: Vec<(u32, u64)> = rows[0]
            .members
            .iter()
            .map(|m| (m.pid, m.started_at))
            .collect();
        assert_eq!(members, [(1, 1001), (2, 1002)]);
    }
}
