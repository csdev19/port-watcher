# F6 — classify listeners and collapse Apps & System

**Status:** planned, not implemented. Execute the four slices below in order.
**Dependencies:** renderer hardening integrated; F2 is not a code prerequisite.
Read [execution index](README.md) and [ADR 0001](../../../adr/0001-desktop-categories-and-watched-ports.md).
Paths below are relative to `apps/desktop`.

## Outcome and invariants

- Listening shows a `N DEV` heading and dev rows, followed by an `APPS & SYSTEM · N`
  disclosure, collapsed on each panel open.
- Search operates on all entries before grouping; a nonempty query with secondary matches
  forces that section open. No hidden row can receive a keyboard kill.
- `app`/`system` kill always requires two actions within two seconds. `dev` preserves
  two mouse clicks and direct `⌘⌫`. `killable: false` never offers or invokes kill.
- Category is a UX heuristic, not backend permission. Keep all guards in `ports/kill.rs`.
- Keep the source's `(port, pid)` ordering inside each group and `pid:port` selection keys.

## Slice 1 — Rust metadata and IPC

### Files

Existing: `src-tauri/src/ports/{mod.rs,models.rs,enrich.rs}`, `src/lib/types.ts`,
`src/lib/mock-ports.ts`, and every test fixture constructing `PortEntry`.
New: `src-tauri/src/ports/classify.rs`.

### Contract

Add `PortCategory` in Rust, derived `Debug, Clone, Copy, PartialEq, Eq, Serialize`,
with serde `rename_all = "camelCase"` and variants `Dev`, `App`, `System`.
Add fields to Rust `PortEntry` and TS mirror together:

| Rust                              | TypeScript / JSON                      | Meaning                                      |
| --------------------------------- | -------------------------------------- | -------------------------------------------- |
| `category: PortCategory`          | `category: "dev" \| "app" \| "system"` | Required classification                      |
| `executable_path: Option<String>` | `executablePath: string \| null`       | Full executable path when available          |
| `app_bundle_path: Option<String>` | `appBundlePath: string \| null`        | Full path through outermost `.app` component |

Export a TS `PortCategory` alias for UI policy. Serialize missing paths as `null`, not
omitted fields. Do not replace `cwd` or change its existing home abbreviation.

### Pure helpers

In `classify.rs`, implement `classify_port(owner_uid: Option<u32>, current_uid: u32,
executable: Option<&Path>) -> PortCategory` and
`app_bundle_path(executable: &Path) -> Option<PathBuf>`.
Use path components; classification precedence is:

1. Missing owner UID, or owner different from current UID → `System`.
2. Absolute executable under `/System`, `/usr/libexec`, or `/usr/sbin` → `System`.
   Use `Path::starts_with` for component boundaries; `/Systematic` is not `/System`.
3. Executable has a normal directory component ending in `.app` → `App`.
4. Otherwise → `Dev` (including no executable with known same-user UID).

For bundle extraction, take the outermost `.app` directory so
`/Applications/Foo.app/Contents/Helpers/Bar.app/Contents/MacOS/Bar` displays
`/Applications/Foo.app`. A final executable filename merely ending in `.app` is not a
bundle directory. Treat matching as case-sensitive in this bounded macOS heuristic.
No shell calls, filesystem traversal, canonicalization or command-string tokenization.

### Enrichment steps

1. Add the module in `ports/mod.rs` with visibility matching sibling helper modules.
2. Extend `ProcessRefreshKind` in `enrich()` with `.with_exe(UpdateKind::Always)`;
   confirm against installed sysinfo 0.39 API during compilation.
3. In `entry_for`, read `proc.and_then(|p| p.exe())`, treat an empty path as unavailable,
   compute bundle and category before building `PortEntry`, using numeric UID already read.
4. Use lossy path-to-string conversion only for serialized display fields. Use `Path` for
   classification. Preserve current command, project detection, cwd, user and killable logic.
5. Update Rust serialization fixture and all TS mock/test entries explicitly. Give mock
   ControlCenter a `/System/.../ControlCenter.app/...` executable, category system, and
   same-user killable metadata; include another-user locked fixture separately.
   Do not infer category from mock labels or make all fixtures dev to keep old tests green.

### Slice 1 tests

Table-test: same-user Node `/opt/homebrew/bin/node` → dev; same-user Homebrew postgres → dev;
other-user executable anywhere → system; unknown owner → system; same-user ControlCenter
inside `/System/...app` → system (precedence); rapportd `/usr/libexec/rapportd` → system;
`/usr/sbin/...` → system; `/Systematic/...` → dev; Discord `.app` → app; missing exe +
same UID → dev; `foo.app-backup` → dev; nested bundles return outermost path; no bundle → None.

Serialization asserts category string plus `executablePath`/`appBundlePath` casing and nulls.
Extend vanished-PID test: category system, null paths, still not killable. Existing live
enrichment test should verify executable metadata if available for its own process.
Run Rust test/check/fmt and renderer check-types from the index before slice 2.

## Slice 2 — close the keyboard confirmation bypass

### Existing behavior to preserve

`PortRow` owns a `useKillConfirm(onKill)` instance; clicking twice confirms.
`App` directly calls `handleKill(current)` for keyboard kill. Move confirmation ownership
to App so both input paths share the same target, timer and invalidation. Do not leave a
second independent row hook active.

### Proposed hook contract

Refactor `src/hooks/use-kill-confirm.ts` to export:

```ts
useKillConfirm(onConfirm: (entry: PortEntry) => void): {
  armedTarget: { key: string; startedAt: number } | null;
  request: (entry: PortEntry, source: "pointer" | "keyboard") => void;
  disarm: () => void;
}
```

`key` is `portKey(entry)`. Before confirmation, resolve the latest entry from the current
visible entries in App and pass that object to `request`; never execute a saved snapshot.

| Event                                                                                            | Transition / effect                                        |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| Request on unkillable entry                                                                      | Disarm; no callback                                        |
| Keyboard request on dev                                                                          | Disarm; call `onConfirm(entry)` immediately                |
| Pointer request on any category, or keyboard on app/system, no matching armed target             | Arm `{ key, startedAt }`, start 2000ms timer; no callback  |
| Same protected request within window, same key and start time                                    | Disarm, call `onConfirm(entry)` once                       |
| Request on another key/incarnation                                                               | Replace target and restart timer; never confirm old target |
| Timer expires / selected row changes / target disappears / becomes unkillable / category changes | Disarm                                                     |
| Query change / disclosure collapse / tab switch / panel reopen / window blur                     | Disarm                                                     |
| Kill button mouse leave                                                                          | Disarm, preserving current pointer behavior                |

Ignore repeated keydown events for kill so holding `⌘⌫` cannot arm then confirm. Ignore
composition events. Cleanup the timer on unmount. Expose no backend IPC from the hook.

### Wiring

1. App owns the hook and continues owning `handleKill`/toasts/invalidation. Change row props
   to receive `armed`, `onRequestKill`, `onDisarm`; remove the local hook from `PortRow`.
   Thread through `PortList` as necessary; name callbacks by intent.
2. In the key handler resolve only from visible entries; call `request(current, "keyboard")`.
   Add guards before navigation for composing/repeat events and controls: Enter/Space on
   focused buttons must activate the button, not expand a row. Keep arrows in main search
   working. F7's form will be an explicit excluded keyboard scope.
3. Before executing, require that the entry still matches visible key/start time and is
   killable. Keep a pending-target set keyed by key/start time to block duplicate IPC while
   `handleKill` awaits; remove in `finally`. This same state will disable F7 duplicates.
4. For app/system, use neutral/muted kill styling even on hover and while armed, visible
   `Kill app?` or `Kill system?`. Dev retains `Kill?` and current danger treatment.
   Keep descriptive accessible labels and existing locks. Color is not the sole distinction.

### Slice 2 tests

Update `use-kill-confirm.test.tsx` with fake timers for every transition, including mixed
pointer/keyboard confirmation, process-incarnation replacement and expiry. Update
`PortRow.test.tsx` for controlled props. App integration tests spy on `killPort`: first
protected shortcut must yield zero calls; second yields exactly one with current metadata;
repeat events yield zero; dev shortcut remains immediate; locked rows never call; changing
selection or polling away the armed process cancels. Pending repeated input yields one IPC.
Run renderer tests and check-types before slice 3.

## Slice 3 — grouping, search and lifecycle

### Derived list model

New `src/lib/port-groups.ts` pure helper partitions already-filtered entries into `dev`
and `secondary` arrays. Return arrays preserving input order. App computes:

```text
filtered = filterPorts(data ?? [], query)
groups = partitionPorts(filtered)
forcedOpen = query.trim() != "" && groups.secondary.length > 0
secondaryOpen = manuallyExpanded || forcedOpen
visibleEntries = groups.dev + (secondaryOpen ? groups.secondary : [])
```

Pass **visibleEntries** to `useListNavigation`. Collapse does not retarget a stale selection
to a hidden row. Keep its existing no-jump-on-disappearance invariant; a subsequent arrow
can choose a visible row. Headings/disclosures are not process entries or kill targets.

### UI and counts

- Adapt `PortList` to render two labelled sections in one scroll region. Avoid two independently
  scrolling flex lists. Add `min-height: 0` to the flex scroll area if needed; retain footer visibility.
- `N DEV` and disclosure counts use filtered listener-row counts; omit an empty dev section.
  Show disclosure only if secondary matches exist. A list containing only collapsed secondary
  rows is not `EmptyState`.
- Use a native HTML button (not a native OS menu) for disclosure, `aria-expanded` and
  `aria-controls`. While search forces expansion, keep it open; disable collapsing and explain
  with an accessible label such as “Apps & System — expanded for search results”.
- Preserve valid DOM: headings/buttons belong outside a listbox, or in labelled section
  wrappers around row lists. Do not put a button directly under `ul`.
- System port numbers use muted token. For non-dev row metadata use
  `appBundlePath ?? executablePath ?? processName`; dev keeps current cwd/project fallback.
  Truncate display only. Add the two new path fields to `filterPorts` haystack so visible
  metadata is searchable. Do not extend search to arbitrary command arguments in this task.
- Footer: `filtered.length ports · groups.dev.length dev`; optionally append the existing
  updated/error suffix if it fits. These are listener-row counts, not distinct port numbers
  and not only expanded rows. Empty search shows totals for the latest snapshot.

### Panel lifecycle

In the existing `panel-shown` handler reset manual expansion, query to empty, detail key,
selection to null and confirmation; refetch then focus main search. Initial mount uses the
same defaults. Clearing query on open is an explicit new behavior (the old handler selected
the existing query). Search entered after opening overrides the collapsed default.

Fix async subscription disposal while touching this effect: use a disposed flag, store
the unlisten function when registration resolves, immediately unlisten if already disposed,
and cleanup otherwise. Do not accumulate handlers after unmount/StrictMode. Reset ephemeral
confirmation on window blur too. Later F7 extends this same lifecycle, not another competing listener.

### Slice 3 tests

Pure partition tests cover order, all-dev, all-secondary, empty input. Filter tests cover
bundle/executable matches and nulls. Update App tests that previously expected every mock
row visible. Test default collapse, keyboard exclusion of hidden rows, manual expansion,
forced search expansion, clearing search restoring manual state, zero matches, only-secondary
data, footer counting collapsed matches, disappearance without selection drift, and panel-shown
reset with mocked Tauri event registration. Verify listener cleanup after delayed registration.

## Slice 4 — integration acceptance

Run full renderer tests/check-types/build and Rust test/check/fmt from the index.
Native checks at the current panel size:

1. Open with tray and shortcut: secondary collapsed, search focused, footer visible.
2. Search `control`: a matching ControlCenter row appears despite its default hidden group,
   with bundle metadata, muted action and two-step confirmation. **Do not confirm a real system kill**;
   use fixtures for invocation tests and a disposable dev listener for real signal acceptance.
3. Expand the group, navigate with arrows, collapse again: hidden selection cannot be killed.
4. Type query, expand details, close/reopen: transient state resets and data refetches.
5. Confirm CSS-only tooltips, command copying and production context-menu suppression still work.

**Done:** all slices and regressions pass, IPC mirrors match, native grouping is checked,
and protected keyboard/pointer tests prove no direct bypass. Report heuristic limitations,
not a claim that every system process is authoritatively classified.
