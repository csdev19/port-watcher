# Evidence: RAM pressure on the owner's M5 Pro (2026-10-29)

Scope: the owner's machine, not the repository. Kept here because it motivates
the "idle dev server alert" idea captured in the tracker (see Linear issue
linked at the bottom). No code version applies. All entries are `observed`
(run in that session) unless marked otherwise.

## Observations

| Id  | Metric                                                                                                                                   | Value                                                                                                                                                                                        | Command                     |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| O1  | Total RAM                                                                                                                                | 24.0 GB                                                                                                                                                                                      | `sysctl hw.memsize`         |
| O2  | PhysMem at start                                                                                                                         | 23 GB used, 93 MB unused, 7.55 GB compressor, 3.46 GB wired                                                                                                                                  | `top -l 1`                  |
| O3  | Swap at start                                                                                                                            | 11.97 GB used of 13.0 GB                                                                                                                                                                     | `sysctl vm.swapusage`       |
| O4  | Compressor at start                                                                                                                      | 2,071,186 pages x 16 KB = 31.6 GB logical held in 7.6 GB physical                                                                                                                            | `vm_stat`                   |
| O5  | Uptime                                                                                                                                   | 6 days 6 h                                                                                                                                                                                   | `uptime`                    |
| O6  | zdpd (Zscaler Data Protection daemon, launchd `com.zscaler.zdp.pd`, root)                                                                | 3.72 GB footprint, 3.47 GB compressed, 0 % CPU, 6 days old                                                                                                                                   | `top -o mem`                |
| O7  | Ardia (Chromium-based browser), 26 "Chromium Helper" processes                                                                           | 5.23 GB footprint                                                                                                                                                                            | `top -o mem`, `ps`          |
| O8  | Brave                                                                                                                                    | 2.86 GB; one renderer (PID 1615) alone is 989 MB, 626 MB compressed                                                                                                                          | `top -o mem`                |
| O9  | node: two Cricut dev servers (2.5 days) and the whole kaipu-record `bun run dev` tree (turbo, astro, hono, workerd, 2 esbuild; 1.4 days) | 2.24 GB                                                                                                                                                                                      | `top -o mem`, `ps`          |
| O10 | Codex renderers (ChatGPT app)                                                                                                            | 1.80 GB                                                                                                                                                                                      | `top -o mem`                |
| O11 | Microsoft Teams                                                                                                                          | 1.74 GB, 1.14 GB compressed                                                                                                                                                                  | `top -o mem`                |
| O12 | claude CLI sessions, 13 processes, several 5 to 6 days old                                                                               | about 3 GB                                                                                                                                                                                   | `ps`, `top`                 |
| O13 | After the owner killed the Cricut node servers and the Zscaler menu-bar app                                                              | Swap 7.9 GB of 9.2 GB; PhysMem still 23 GB used; zdpd unchanged (PID 16808, 3.75 GB, still 6 days old: the menu-bar app restarted, the daemon did not); kaipu `bun run dev` tree still alive | same commands, 15 min later |

## Derived

| Id  | Value                                                                                                          | Formula      |
| --- | -------------------------------------------------------------------------------------------------------------- | ------------ |
| D1  | Logical demand about 59 GB against 24 GB physical (15.5 GB resident + 31.6 GB compressed-logical + 12 GB swap) | O2 + O4 + O3 |
| D2  | Killing two node servers and Teams-level noise freed about 4 GB of swap                                        | O3 - O13     |

## Hypotheses

- H1: zdpd is leaking. 3.7 GB for an idle daemon is abnormal. Check its footprint a day after a reboot.
- H2: Stale dev servers and old agent sessions hold about 5 GB nothing uses. A reboot or a kill of the parent `bun run dev` processes frees it.
- H3: Switching engines (Chromium to WebKit) saves less than closing idle tabs: the cost is 26 live renderer processes, not the engine per se.

## Missing

- Whether the planned CPU tests need significant RAM of their own (unknown workload).
- zdpd footprint after a fresh boot (needed to confirm H1).

## Decisions and ideas from the session

- The repo has no RAM mapping tool. `pichay-mac-cleaner` maps disk; `invisible-assistant` only reads total RAM to pick a local model.
- Idea captured in the tracker: a script that maps RAM per app plus an alert for idle dev servers that still hold a listener, so this mapping never costs agent tokens again.
- Restarting zdpd without a reboot needs root: `sudo launchctl kickstart -k system/com.zscaler.zdp.pd`.
- The kaipu-record dev tree is killed by its parents: `kill 9856 9866` (PIDs valid only until reboot).
- Owner's plan: reboot after this session.

Tracker: NIW2-549 "RAM map script and idle dev server alert", https://linear.app/niway/issue/NIW2-549

Follow-up research on the two browsers (Ardia as core, Brave as viewer) lives in the Linear project
browsers-research (P-NIW2-29): issues NIW2-554 (Brave tuning and measurement), NIW2-555 (one week on
Search, WebKit, with a DRM matrix) and NIW2-556 (hub page on how a WebKit browser is built), plus the
document "Findings 2026-10-29: RAM, Ardia, Brave, WebKit viewer feasibility".
