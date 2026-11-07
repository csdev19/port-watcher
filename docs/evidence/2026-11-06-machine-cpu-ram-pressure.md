# Evidence: CPU and RAM pressure on the owner's M5 Pro (2026-11-06)

Scope: the owner's machine, not the repository. Follow-up to
`2026-10-29-machine-ram-pressure.md` (on branch `docs/ram-evidence-2026-10-29`, NIW2-549).
Trigger: the laptop fans became audible again. No code version applies.
All entries are `observed` (run in this session) unless marked otherwise.

## Observations

| Id  | Metric                                                                            | Value                                                                                                                                                                                                                                               | Command                                                  |
| --- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| O1  | Uptime                                                                            | 8 days 14 h 58 min (no reboot since 2026-10-29)                                                                                                                                                                                                     | `uptime`                                                 |
| O2  | Load average (10 cores)                                                           | 13.95 / 13.03 / 10.56                                                                                                                                                                                                                               | `uptime`                                                 |
| O3  | CPU split                                                                         | 34.0 % user, 26.5 % sys, 39.9 % idle (sys is high: kernel work, not app work)                                                                                                                                                                       | `top -l 2`                                               |
| O4  | PhysMem                                                                           | 23 GB used, 256 MB unused, 4.15 GB wired, 9.7 GB compressor                                                                                                                                                                                         | `top -l 1`                                               |
| O5  | Swap                                                                              | 18.3 GB used of 19.5 GB (was 12 GB of 13 GB on 2026-10-29)                                                                                                                                                                                          | `sysctl vm.swapusage`                                    |
| O6  | Swap traffic since boot                                                           | 26.9 M swap-ins, 31.1 M swap-outs; 3.6 G decompressions, 3.9 G compressions                                                                                                                                                                         | `top -l 1`, `vm_stat`                                    |
| O7  | zdpd (Zscaler daemon, PID 1101)                                                   | **16 GB footprint**, 15 GB compressed, 23 % CPU, age 8 d 14 h (was 3.72 GB, 0 % CPU)                                                                                                                                                                | `top -o mem`, `ps`                                       |
| O8  | com.avira.scanservice (PID 522)                                                   | 66 % CPU, 362 MB; macOS logged a CPU-limit report on 2026-11-04 (63 % avg over 143 s)                                                                                                                                                               | `top -o cpu`, `.cpu_resource.diag`                       |
| O9  | kernel_task / WindowServer                                                        | 68 % CPU / 40 % CPU, WindowServer 929 MB                                                                                                                                                                                                            | `top -o cpu`                                             |
| O10 | Two Virtualization VMs                                                            | 1.83 GB + 1.15 GB footprint (1.96 GB + 2.5 GB compressed)                                                                                                                                                                                           | `top -o mem`                                             |
| O11 | Ardia main process                                                                | 621 MB, age 1 d 4 h (not multi-day this time)                                                                                                                                                                                                       | `ps`, `top`                                              |
| O12 | node processes                                                                    | 951 MB + 612 MB; 5 `node` SIGABRT crash reports between 15:53 and 15:57 today                                                                                                                                                                       | `top -o mem`, `.ips` reports                             |
| O14 | Closing the Zscaler menu-bar app from the UI (owner, 23:59)                       | zdpd unchanged: same PID 1101, same age, 16 GB; swap rose to 18.9 GB, load 28                                                                                                                                                                       | `ps`, `top`, `launchctl print`                           |
| O15 | `sudo launchctl kickstart -k system/com.zscaler.zdp.pd` (owner, 2026-11-07 00:00) | zdpd restarted as PID 74925: 114 MB footprint at 14 s, 143 MB a few minutes later; swap 17.3 GB; load 17.9 then 7.1 after a few minutes; owner reports the fans went quiet                                                                          | `top -pid`, `sysctl vm.swapusage`, `uptime`              |
| O16 | Second fan episode (2026-11-07 00:1x), memory side                                | pressure level 1 (normal), swap 17.0 GB, zdpd 200 MB: memory is not the cause this time                                                                                                                                                             | `sysctl kern.memorystatus_vm_pressure_level`, `top -pid` |
| O17 | Second fan episode, CPU side                                                      | `fseventsd` 145 %, sys 55 %, load 11.4; Avira scanservice 36-42 %, `duetexpertd` 46 %, 16 `mdworker`; a `bun test` from another agent session was running; two minutes later `fseventsd` had left the top list and only Avira and `zdpesd` remained | `top -o cpu`, `ps`                                       |
| O13 | Other large apps                                                                  | T3 Code 881 + 838 MB, Teams 877 MB, Claude helper 701 MB, Codex renderer 616 MB, Finder 582 MB                                                                                                                                                      | `top -o mem`                                             |

## Derived

| Id  | Value                                                                     | Formula            |
| --- | ------------------------------------------------------------------------- | ------------------ |
| D1  | zdpd grew about 4.3x in 8 days of uptime (3.72 GB to 16 GB)               | O7 / 2026-10-29 O6 |
| D2  | Swap is 94 % full (18.3 / 19.5 GB); macOS has little room left to grow it | O5                 |
| D3  | zdpd alone is about 67 % of physical RAM (16 / 24 GB), mostly compressed  | O7 / hw.memsize    |

## Hypotheses

- H1 (strengthened from 2026-10-29 H1): zdpd leaks. Two readings, 3.72 GB then 16 GB, both on the same
  boot, both growing. Not yet proven: no reading right after a boot, and the 16 GB footprint may include
  compressed pages that overstate real use.
- H2: the fans come from memory thrashing, not from one busy app. High sys CPU (O3), 68 % kernel_task
  (O9) and a full swap (O5) fit a machine spending its time compressing and decompressing pages. Avira
  (O8) and WindowServer (O9) add real load on top.
- H3: the five node SIGABRT reports (O12) at 15:53-15:57 may be a crash loop under memory pressure.
  Their stack was not read, so the cause is unknown.
- H4: Ardia's helpers are not the main problem this time (O11).

- H5 (from O14, O15): a UI-level quit never reaches a root launchd daemon; only a privileged
  `kickstart -k` (or a reboot) frees its memory. Restarting zdpd freed about 16 GB of logical demand
  and brought the load from 28 to 7 within minutes. Supports H1 and H2; H1 still needs a growth
  reading over the next days.

- H6 (from O16, O17): the second episode is a filesystem-event storm, not memory. A burst of file
  writes (a test run in another session is the candidate) makes `fseventsd` fan out events to every
  watcher, and the Avira scanner plus Spotlight re-scan each file. Not proven: `fs_usage` needs root
  and was not run, so the writer is unidentified.

## Missing

- zdpd footprint right after a fresh boot (confirms or kills H1). Cost: one reboot, then one command.
- The node crash stack and which process was crashing (cost: minutes, read the `.ips` thread frames).
- Whether the 16 GB is resident or compressed-only (cost: `vmmap` on a root process, needs sudo).

## Candidate signals for chapay (proposal, not built)

If chapay predicts memory trouble, these are the cheap, measurable signals seen here. Each needs a
threshold validated over several sessions before use.

1. Swap used / swap total above about 80 % (O5 / D2).
2. Any single process footprint above a fraction of physical RAM, using `top -stats mem` footprint, not
   RSS, which misleads under swap (D3).
3. Process growth over uptime: sample footprint on a schedule and flag monotone growth (D1).
4. High `sys` CPU share together with high swap activity: the signature of thrashing (O3, O6).
5. Long-lived dev servers and agent sessions (2026-10-29 O9, O12), already the idea in NIW2-549.
6. Repeated crash reports from the same binary in a short window (O12).

Decisions and tracker: none yet; to be agreed with the owner.
