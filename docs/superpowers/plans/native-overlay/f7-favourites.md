# F7 — persistent watched ports and live favourites

**Status:** planned. Execute slices serially after F6 passes.
Read [execution index](README.md), [F6 contracts](f6-port-categories.md), and
[ADR 0001](../../../adr/0001-desktop-categories-and-watched-ports.md).
Paths below are relative to `apps/desktop`. No Rust or new IPC changes are needed.

## Outcome

Provide `Listening | Favourites` tabs with counts. A manually watched TCP port survives
process restarts and app restarts. It displays current listeners or `nothing listening`
when a successful snapshot has none. Reopening always selects Listening.

Use “Favourites” consistently in UI, identifiers and storage (`chapay.favourites`).
The saved entity is a port number, not a process, address, reservation or background monitor.
Polling remains the existing visible-only `usePorts` query, shared by both tabs.

## Slice 1 — validated persistence

### New files and API

Create `src/lib/favourites.ts` with pure validation/serialization helpers and types:

```ts
export interface FavouritePort { port: number; name?: string }
export const FAVOURITES_STORAGE_KEY = "chapay.favourites";
```

Create `src/hooks/use-favourites.ts` owning `items`, `error`, `add`, `remove` and
`clearError`. Suggested mutation result: `{ ok: true } | { ok: false; message: string }`.
The hook reads storage in a lazy state initializer, not during every render.

### Validation contract

- User port input is trimmed decimal digits only, converts to an integer in 1–65535.
  Reject empty, signs, exponent notation, decimals, NaN, infinity, zero and out-of-range.
  Leading zeros are accepted and normalized to the number ("03000" → 3000).
- Trim optional name, omit if empty, limit to 80 characters with inline validation.
  This length is an implementation default; use the same rule when loading saved records.
- Ports are unique. Manual duplicate submission says `Port 3000 is already watched`;
  do not silently rename or add another record. Row watch action is idempotent.
- Preserve insertion order. No sorting preferences or rename workflow in this scope;
  remove/re-add can change the saved name.
- Loading absent key → empty list. Malformed JSON or a non-array → empty list plus
  non-blocking `Could not load watched ports` error, without overwriting storage on mount.
- For an array, discard invalid records; keep the first valid occurrence of each port;
  strip unknown fields; discard invalid names while retaining a valid port. Surface a
  recovery notice if records were normalized/discarded. Do not write automatically on load.
- Catch storage getter, getItem, setItem and JSON errors. Read failure leaves the rest
  of the app usable. Mutation failure returns an error and keeps the previous in-memory
  list; do not show a successful persistent watch that will vanish at restart.
- Compute next records, synchronously serialize/write once in the explicit action, then
  set state. Do not write inside a React state-updater callback or an unconditional effect.
  Keep a current-items ref if needed to make back-to-back actions read the latest list.

### Slice 1 tests

New `src/lib/favourites.test.ts` and `src/hooks/use-favourites.test.tsx`: boundaries 1/65535,
invalid forms above, normalized duplicate ports, trimmed/empty/too-long names, absent storage,
malformed JSON, wrong root shape, mixed valid/invalid records, duplicate stored ports,
unknown fields, insertion order, successful remount persistence, read/write exceptions,
no writes on mount and unchanged UI state after failed write. Clear localStorage and mocks
between tests. Run renderer tests/check-types.

## Slice 2 — pure live join and availability

In `src/lib/favourites.ts`, add a pure `joinFavourites(items, entries)` helper returning:

```ts
interface FavouriteMatch {
  favourite: FavouritePort;
  listeners: PortEntry[];
}
```

Build one `Map<number, PortEntry[]>` from the snapshot and map favourites in saved order.
Preserve snapshot order within each listeners array. Do not use `find` or duplicate the
Rust IPv4/IPv6 dedupe. Keep query health separate from this pure join:

| Query state                       | Favourite presentation                         | Kill                              |
| --------------------------------- | ---------------------------------------------- | --------------------------------- |
| `data === undefined`, no error    | `checking…`, neutral indicator                 | None                              |
| `data === undefined`, error       | `status unavailable`, retry action             | None                              |
| Successful snapshot, zero matches | `nothing listening`, green dot                 | None                              |
| Successful snapshot, matches      | Current live rows, “in use” text               | F6 policy                         |
| Retained data plus error          | Last known rows/status explicitly marked stale | Disabled until successful refresh |

An in-progress normal refetch without error can keep the successful snapshot visible.
“Nothing listening” means not observed in the last successful local TCP snapshot, not
a guarantee a future bind succeeds. Do not create sockets to test or reserve the port.

### Counts and multiple listeners

- Listening tab badge = latest snapshot listener-row count (including collapsed rows).
  Before initial data use a neutral dash, not a fabricated count.
- Favourites badge = saved unique watched-port count, independent of query and tab.
- Favourites footer = `N watched · M in use`, where M is number of favourites with at
  least one listener, never the sum of PIDs. Counts cover all favourites, not search matches.
  With no successful data use `N watched · checking…` or `N watched · status unavailable`;
  with error and retained data append `· update failed` to last-known counts.
- Multiple PIDs on one watched port: show a watch heading (port + saved name) with separate
  reusable live `PortRow`s beneath it, each with its own PID/detail/kill action. No bulk kill.
- One PID on several watched ports: preserve rows; after killing that PID, the shared
  refetch updates every affected watch. Saved favourites are never removed by a kill.

### Slice 2 tests

Join no listeners, one listener, two PIDs on one port, one PID on two ports, saved order,
live metadata replacement after restart, and immutable inputs. Count two PIDs on a watched
port as one in-use watch. Test loading/error/stale presentation at the component level in
slice 3 so empty arrays cannot masquerade as successful queries.

## Slice 3 — tab and watch UI

### File boundaries

Existing: `src/App.tsx`, `src/app.module.css`, `src/components/PortRow.tsx`,
`src/components/PortList.tsx`, `src/components/Icon.tsx` and their tests.
New: `src/components/FavouritesPanel.tsx`, `src/components/WatchPortForm.tsx`.
Keep storage in the hook and the live join in the helper. Components receive data/actions;
they must not invoke `listPorts`, start timers for polling or call `killPort` directly.

### Tabs and search

1. Add local `activeTab: "listening" | "favourites"` default Listening in App.
   Mount `usePorts` once regardless of tab. Keep the main search above the active view.
2. Use labelled tab buttons with `role="tab"`, `aria-selected`, `aria-controls`, roving
   tabIndex, a `tablist` and corresponding `tabpanel`. Left/right arrows move/activate tabs;
   Home/End select first/last. Stop these handled events before list navigation.
3. On tab switch clear query, detail expansion, selected key and confirmation; focus search
   when switching by a pointer if appropriate, but keep keyboard tablist focus for arrows.
4. On panel-shown extend F6's existing reset to Listening, close/reset watch form and transient
   validation errors. Persist only the watched list; no active tab or section state in storage.
5. Favourite search includes numeric port-prefix, saved name and the same live fields as
   `filterPorts`. If a watch's name/port or any listener matches, render the whole watch
   and all its listener rows so other processes sharing the port are not silently hidden.
6. Empty saved list: `No watched ports yet` plus `Watch a port`. Nonempty saved list with
   no search matches: a filtered-empty message and Clear search. These differ from a free watch.

### Form

- `+ Watch a port` expands an inline form inside the webview, not `window.prompt`/native dialog.
- Fields: `Port` required text input with `inputMode="numeric"`, `Name (optional)` text input;
  Add and Cancel buttons. Use F3 assistance props and F5 selectable-input CSS exceptions.
- On open focus Port. Submit with Enter via native form `onSubmit`; prevent default,
  validate, persist through hook, then close form and focus its trigger on success.
  If hidden by filtering, clear query so the newly added watch can be found.
- On validation/write failure remain open, display inline error linked with `aria-describedby`,
  set `aria-invalid` on the relevant field, and preserve typed values.
- Escape closes the form first without hiding the panel; Cancel behaves the same.
  Next Escape outside the form closes the panel normally.
- Mark the form as an excluded list-shortcut scope (for example `data-list-shortcuts="off"`).
  App's global handler must return early for targets within it. Arrow keys and `⌘⌫` edit
  fields, never navigate or terminate a listener. Handle form Escape locally and stop propagation.
- Use text errors rather than native validation bubbles if browser constraint validation
  would create overlays; manual validation with `noValidate` on the form is suitable.

### Watching and removal

- Add an accessible star/watch button to listening rows: `Watch port 3000`, or
  `Port 3000 is watched` when saved. Use `Icon`'s existing Lucide wrapper; add only needed names.
  No native `title`. Stop propagation so clicking it does not expand details or trigger kill.
- A row watch action adds `{ port }` without auto-saving the process label; labels change as
  processes restart. All rows sharing that port reflect the saved state.
- Render an explicit `Remove watched port 3000` action per watch in Favourites. Removal
  only changes storage, works when free or in use, and never invokes kill. No confirmation
  dialog is necessary. Failed storage mutation leaves the watch visible with an error.
- Saved name belongs in the watch heading/free row. Live `PortRow.label` remains the process
  label; do not clone live entries with overwritten labels/command fields.
- Reuse F6's neutral protected kill, lock, details, pending status and command copying.
  The Favourites view does not collapse app/system matches behind Listening's disclosure.

## Slice 4 — navigation and kill integration

App derives the active tab's navigable live entries. In Favourites, flatten only the currently
visible watches' listener arrays, in render order; when snapshot is stale keep actions disabled.
Pass this array to the existing identity-based navigation hook. Free/unknown watch rows are
not fake `PortEntry`s, have no synthetic PID/start time and cannot be keyboard kill targets.
Their remove buttons and form remain reachable via Tab.

All kill requests use F6's shared confirmation/controller and resolve current visible live
metadata, not persisted items. Tab/query/watch removal/availability changes disarm. Keep the
backend `{ pid, port, startedAt }` request unchanged. Disable duplicate in-flight requests
using the same pending identity state. Shared query invalidation refreshes both views.

Global Enter should expand only while search/list navigation owns the interaction, not when
a focused button or form needs native activation. Add regression tests for Tab → Remove →
Enter and Tab → watch button → Enter. Do not globally swallow these keys.

## Slice 5 — composed regression and native acceptance

Extend `src/App.test.tsx`, add focused component tests as needed, and mock `usePorts` or
the IPC seam for mutable snapshots. Do not rely on the static browser mock to simulate live changes.

Required behavioral cases:

1. Add named free port, remount, switch to Favourites: saved record remains; starts on Listening.
2. Add via listening row; another PID on same port shows watched state; count increases once.
3. Successful empty snapshot displays green/free; no-data loading/error never displays green/free.
4. Start/stop snapshots switch free → in use → free without modifying localStorage.
5. PID and start-time replacement renders latest metadata and cannot confirm an old target.
6. Two PIDs at one port show two actions, one in-use count; kill targets only the chosen PID.
7. App/system shortcut requires two actions in Favourites too; locked and stale rows never invoke.
8. Remove a live watch without killing; write failure retains it and exposes error.
9. Form Enter submits, Escape cancels before panel hide, arrows/`⌘⌫` do not reach row navigation.
10. Search by saved name and live path; matching watch keeps all its live rows; clear restores list.
11. Panel reopen resets tab/query/form/confirmation, keeps saved list, refetches once through
    the existing listener. Switching tabs does not create an extra polling source.
12. Kill toast/copy and pending disable behavior match Listening, including rejected IPC.

Run full renderer test/check-types/build from the index. F7 itself requires no Rust changes;
run the native build to verify packaged integration. Native acceptance uses a disposable local
TCP listener: watch its port, start it, observe next successful two-second poll, kill it via
confirmation, observe free state, restart process, and confirm new PID/details. Quit/relaunch
the same packaged app and confirm persistence; browser preview uses a different storage origin.

Check overflow at the existing panel dimensions with long name, path, expanded command and
open form. One scrolling content area, visible tabs/footer, keyboard-accessible controls, no
native tooltip/dialog, and selectable input/command text are required.

**Done:** persistent mutations survive restart, query-health states are honest, joins retain
all listeners, and pointer/keyboard tests prove F6 protection survives reuse. Report storage
origin tested and any native checks not performed. No notifications or hidden background
watching should be implied by the word “watched”.
