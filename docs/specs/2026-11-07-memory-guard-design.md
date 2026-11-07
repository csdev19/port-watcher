# Memory guard

**Status:** approved by the owner in the design conversation of 2026-11-07 (tracker NIW2-549,
issue #55). Implemented on branch `feat/memory-guard`; not on `main` until that PR merges.

## Summary (one minute)

chapay watches the Mac's memory the way it watches its temperature: the background sampler that
already reads the die temperature every 60 s ([ADR 0008](../adr/0008-background-thermal-sampling.md))
also reads memory pressure, swap and the physical footprint of the biggest processes, keeps them in the
same SQLite history, and shows them in a **Memory** tab on the panel and in Settings. The tab says
whether memory is fine, worth watching or the reason the fans are on, names the process behind it,
and offers the same guarded kill as Ports. For a process chapay may not kill (root, a launchd daemon),
it shows the exact Terminal command to restart it and a Copy button; it never runs anything with
privileges. The motivating case is the evidence of 2026-10-29 and 2026-11-06: a root daemon grew
from 3.7 GB to 16 GB over eight days, filled the swap and spun the fans; nothing on the machine named
it, and quitting it from the UI changed nothing.

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                              | Why                                                                                                                                                        | ADR         |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 1   | Memory is sampled on the thermal sampler's tick (60 s, background, same lock), behind its own `memoryGuardEnabled` setting                                                                                                                                                                                                                                                                                            | One timer, one wake-up; a guard that only looks while the panel is open misses the growth                                                                  | 0011 (new)  |
| 2   | Per-process memory is `phys_footprint` from `proc_pid_rusage`, never RSS; for root and other users' PIDs (unreadable without privileges) the figure comes from one `top -l 1 -o mem` run per 5-minute bucket; system memory from `host_statistics64`, swap from `vm.swapusage`, pressure from `kern.memorystatus_vm_pressure_level`                                                                                   | RSS omits compressed pages: the 16 GB daemon showed as 1 GB RSS. `top` is the only sudoless source for root daemons; per bucket it costs ~0.37 % of a core | 0011        |
| 3   | Four signals with default, editable thresholds: pressure ≥ warning; swap ≥ 80 %; one process ≥ 25 % of physical RAM; a process that doubled its footprint since its first retained sample and exceeds 2 GB ("growing")                                                                                                                                                                                                | Each one was present in the evidence; the growth signal is the only one that would have named the daemon on day 2                                          | 0011        |
| 4   | Kill goes through the existing `is_killable` policy; a process the policy refuses gets a command card (`sudo launchctl kickstart -k system/<label>`, or `sudo kill <pid>` when no daemon label is found) with Copy and a one-line note; chapay never elevates; the card is only for another user's non-Apple process: Apple system processes (including those owned by you) are shown as protected, without a command | Option A of the design: show and recommend, not invasive; ADR 0006 keeps its boundary                                                                      | 0012 (new)  |
| 5   | History reuses `thermal.sqlite` with new tables (schema step 2): 5-minute memory buckets, per-process footprint samples for the top N, daily summaries; 90-day retention for buckets and samples                                                                                                                                                                                                                      | Same store, same retention rules, same lock; the growth signal needs retained per-process samples                                                          | reuses 0009 |
| 6   | Panel tabs become Ports, Thermal, Memory; Settings gains a Memory section with history and thresholds                                                                                                                                                                                                                                                                                                                 | Owner: a new section like Thermal. Thermal and Memory are the two halves of a future Machine tab                                                           | —           |
| 7   | A notification when the verdict reaches STOP, at most once per 15 minutes, only while the guard is on                                                                                                                                                                                                                                                                                                                 | Same rule as the temperature guard                                                                                                                         | —           |

## Open questions

- Measured 2026-11-07: `proc_pid_rusage` over 192 readable PIDs costs 0.2–0.7 ms per tick; the
  `top` run per bucket is the dominant cost (~1.1 s CPU / 300 s). Both stay inside ADR 0008's 1 %
  budget; re-measure on a machine with many more processes.
- A root process that grows but never enters `top`'s top 16 by footprint is not sampled; the growth
  signal sees only the top 8 merged rows. Acceptable for v1: the case that matters is, by
  definition, among the biggest.
- Whether the growth signal needs a longer baseline than "first retained sample" once 90 days of data
  exist (a process that legitimately grew over a month). Revisit with the owner's data.
- Filesystem-event storms (`fseventsd` + scanners) were the second fan cause in the evidence; naming
  the writer needs root (`fs_usage`). Out of this spec; recorded as a gap.

## Out of scope

- Any privileged action (osascript, SMAppService helper). The command card is the whole answer.
- The RAM map shell script and the idle-dev-server alert of NIW2-549 (the per-process samples make
  the second one possible later).
- A merged Machine tab, the full window and the alert rules of PR #67; this spec takes code from
  that branch (`crates/system-health/src/infra/{memory,procs,sysctl,ffi}.rs`,
  `domain/memory.rs`), not its product decisions.
- GPU, disk, network.

## Failures this must protect against

- A footprint read fails for one PID (it exited, or `EPERM`): that PID is skipped, the tick continues.
- `host_statistics64` or a sysctl fails: the memory reading is `null`, the tab says "unavailable",
  nothing is written, nothing crashes.
- Two chapay processes share the store: memory sampling runs only in the process holding
  `thermal.sampler.lock`, like thermal.
- PID reuse: per-process samples carry PID + start time; a new incarnation starts a new series and the
  growth signal never compares across incarnations.
- The guard is off: no memory read, no write, no notification; the Memory tab still reads the current
  state while open.
- The command card for a daemon shows a wrong label: the label comes only from a
  `/Library/LaunchDaemons/*.plist` whose `Program`/`ProgramArguments[0]` equals the process's
  executable path; otherwise the fallback `sudo kill <pid>` is shown with "launchd will restart it if
  it is a service".
- Notification spam during a long swap episode: one per 15 minutes at most.
- The Ports tab stays as cheap as before: no memory command runs while it is the active tab.

## Acceptance criteria

- [ ] The panel's tabs are Ports, Thermal and Memory; keyboard navigation between tabs still works.
- [ ] The Memory tab shows pressure, used/total, swap used/total, compressed, a verdict (OK / WATCH /
      STOP) with its reasons, and the top processes by footprint with their flags (big, growing)
      and listening ports.
- [ ] A killable row offers Kill through the existing confirmation; a non-killable row shows the
      command card with a Copy button and the note only when it is another user's non-Apple process
      (an Apple system process owned by the user is protected, with no command; unit test).
- [ ] The Memory tab lists every process chapay can attribute (`processes`), not only the top 8,
      in two groups: **Yours** (killable) and a collapsed **Protected** group with the reason on
      each row and a "Show command" link only where there is a command.
- [ ] Rows under 50 MB are folded behind "Show all" with a "N smaller processes" line, and a
      "Not attributed to a process" line shows `usedBytes` minus the listed footprints.
- [ ] The sampler records memory every 60 s with the panel hidden while `memoryGuardEnabled` is on,
      and reads nothing while it is off (unit test on the gate).
- [ ] Per-process samples carry PID and start time; the growth flag is computed per incarnation
      (unit test with a PID reused).
- [ ] Thresholds have the defaults of decision 3, are editable in Settings › Memory, and the verdict
      uses the stored values (unit test).
- [ ] Settings › Memory shows today's chart (swap and used memory from the buckets), the last 7 days'
      summaries and the current top processes.
- [ ] A notification fires when the verdict reaches STOP, at most once per 15 minutes (unit test on
      the rate limit).
- [ ] Rows older than 90 days are pruned; daily summaries stay (unit test on the cutoff).
- [ ] `cargo test`, `cargo clippy`, `bun run test` and `bun run check-types` pass.

## Detail

### Verdict

| Verdict | When                                                                            |
| ------- | ------------------------------------------------------------------------------- |
| OK      | pressure normal and no signal fired                                             |
| WATCH   | pressure warning, or swap ≥ 80 %, or a process ≥ 25 % RAM, or a growing process |
| STOP    | pressure critical, or swap ≥ 95 % together with a process ≥ 25 % RAM            |

Reasons are listed in the order above. `STOP` is deliberately conservative: pressure critical is the
OS's own judgement; the swap rule reproduces the 2026-11-06 state (94 % swap, one 16 GB process).

### Commands and types (the IPC contract)

See `docs/plans/2026-11-07-memory-guard.md`, section "IPC contract"; the plan is deleted by the
shipping PR, after which `apps/desktop/src-tauri/src/memory/api.rs` and `apps/desktop/src/lib/types.ts`
are the contract.

### Sources

- Evidence: `docs/evidence/2026-10-29-machine-ram-pressure.md` (branch `docs/ram-evidence-2026-10-29`),
  `docs/evidence/2026-11-06-machine-cpu-ram-pressure.md`.
- macOS figures: `phys_footprint` vs RSS ([trusty-common](https://docs.rs/crate/trusty-common/0.49.0/source/src/sys_metrics.rs),
  [footprint(1)](https://www.unixtutorial.org/commands/footprint/)); pressure sysctl
  ([newosxbook](https://newosxbook.com/articles/MemoryPressure.html)).
- Privilege options considered and rejected for now: osascript one-shot and SMAppService helper
  ([Apple forums 768765](https://www.developer.apple.com/forums/thread/768765),
  [750918](https://developer.apple.com/forums/thread/750918)).
- Prior art: Stats, MemStat, MemStats show pressure and swap; none names an action.
