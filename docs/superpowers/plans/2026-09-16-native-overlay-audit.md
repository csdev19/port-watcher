# Native-overlay audit: residual panel flicker + tray icon

**Status:** report only — no code changed. Findings mapped for a later execution pass.
**Context:** PR #3 (`fix/native-tooltip-flicker`) removed the two `title` attributes in the
renderer, but the panel still flickers/vibrates in some situations (reported over a
fullscreen, semi-transparent cmux window), and a native tooltip reading **"chapay"** still
appears over the panel (see user screenshot, 2026-09-16). The menu-bar icon also still
shows the colored bundle icon.

The mechanism PR #3 documented is the class to audit for: **any OS-level overlay window
painted over (or near) a `transparent: true` Tauri window forces a recomposite that reads
as the whole panel flickering.** Removing `title` attributes fixed two instances; the
audit below found the remaining ones.

---

## F1 — Tray tooltip is the residual flicker (root cause, confirmed by screenshot)

- **Where:** `apps/desktop/src-tauri/src/lib.rs:39`
  ```rust
  let mut tray = TrayIconBuilder::with_id("chapay-tray").tooltip("chapay");
  ```
- **Mechanism:** `.tooltip("chapay")` creates a native `NSToolTip` on the tray icon. The
  panel is anchored `TrayBottomCenter`, i.e. its top edge sits directly under the tray
  icon — exactly where macOS draws that tooltip. When the cursor lingers on/near the tray
  icon after opening the panel, the tooltip window paints/unpaints over the panel's top
  edge, forcing the recomposite → the "vibration". The screenshot shows the native
  "chapay" tooltip rendered on top of the panel, over the PID row.
- **Why it looks intermittent:** it only fires when the mouse rests near the tray icon,
  and it is far more visible when the window behind is itself transparent/repainting
  (fullscreen cmux with transparency).
- **Fix:** remove `.tooltip("chapay")` entirely. A menu-bar app gains nothing from a
  tooltip that repeats the app name; no replacement needed.
- **Verify:** open panel, hover the tray icon ~1s. Before: "chapay" tooltip appears and
  panel flickers. After: no tooltip, no flicker. Repeat over a transparent cmux
  fullscreen window.

## F2 — Menu-bar (tray) icon never updated: template image was deferred and never shipped

- **Where:** `apps/desktop/src-tauri/src/lib.rs:40-46` — comment says explicitly:
  _"Default icon until the design pass ships the template image. Do NOT set
  icon_as_template(true) yet."_ The tray falls back to `app.default_window_icon()`
  (the colored bundle icon from `tauri.conf.json`).
- **Why it never changed:** PR #4 (`feat/desktop-icons-v2`) only wired Lucide icons in
  the renderer; it shipped no tray asset, so the deferral is still active.
- **Fix (execution steps):**
  1. Produce a monochrome template asset: black shapes + alpha only (macOS recolors it
     for light/dark menu bar). Suggested: `src-tauri/icons/tray-icon.png` (22×22 pt
     equivalent) + `tray-icon@2x.png` (44×44).
  2. In `lib.rs`, replace the `default_window_icon()` fallback:
     ```rust
     let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray-icon.png"))?;
     tray = tray.icon(icon).icon_as_template(true);
     ```
  3. Delete the deferral comment.
- **Verify:** icon renders monochrome and inverts correctly in light and dark menu bar.

## F3 — Search input can spawn native autocorrect/spell-check bubbles (same overlay class)

- **Where:** `apps/desktop/src/components/SearchInput.tsx` — the `<input type="text">`
  has no autocorrect/spellcheck suppression.
- **Mechanism:** WKWebView shows native correction/completion popovers (autocorrect
  bubble, spelling underline popover) on plain text inputs. Those are OS overlay windows
  over the transparent panel — same recomposite flicker, triggered by typing.
- **Fix:** add to the input:
  `autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}`.
  (Ports/app names/paths are not prose; suppression also stops bogus corrections.)
- **Verify:** type a misspellable word (e.g. "postgress") in the search box; no native
  bubble or red underline popover appears.

## F4 — Native right-click context menu inside the panel (same overlay class)

- **Where:** renderer-wide; nothing suppresses `contextmenu`.
- **Mechanism:** right-click anywhere in the panel opens WKWebView's native context menu
  — another OS overlay over the transparent window, plus it offers items that make no
  sense in a menu-bar panel (Reload, etc.).
- **Fix:** in `App.tsx` (or `main.tsx`), suppress in production only, keeping dev
  right-click → Inspect Element usable:
  ```ts
  if (import.meta.env.PROD) {
    window.addEventListener("contextmenu", (e) => e.preventDefault());
  }
  ```
- **Verify:** production build: right-click does nothing. Dev: inspector still reachable.

## F5 — Text selection / native drag images (minor, same class)

- **Where:** `apps/desktop/src/app.module.css` — no `user-select` rules exist.
- **Mechanism:** click-dragging over labels selects text; dragging a selection spawns a
  native drag image (overlay). Cosmetic, low frequency.
- **Fix:** `user-select: none` on the panel chrome (rows, header, footer), keeping the
  expanded command block (`.detail` code area) selectable so users can still copy it.
- **Verify:** dragging across rows selects nothing; the command text remains selectable.

---

## Not findings (checked and ruled out)

- No `title=` / `alt=` attributes remain in the renderer (`grep` clean).
- Lucide icons render no SVG `<title>` elements; `Icon.tsx` sets `aria-hidden`.
- `tauri.conf.json` window `title` is not a tooltip source (window is undecorated).
- `index.html` `<title>` is the document title, not an overlay.

## Suggested execution order

1. **F1** — one-line removal; fixes the reported bug. Branch: `fix/tray-tooltip-flicker`.
2. **F3 + F4 + F5** — small renderer hardening, one branch: `fix/native-overlay-hardening`.
3. **F2** — needs a design asset first (template PNG), then the `lib.rs` wiring. Branch:
   `feat/tray-template-icon`.

Each fix should land per the repo flow: branch → PR → merge; verification steps above are
the acceptance criteria.

---

# Feature additions approved 2026-09-16: categories + favourites

Approved in brainstorming (bounded path). Design references: user mockups 4a/4b
(collapsible "APPS & SYSTEM" section) and 3b (Favourites tab).

## F6 — Port classification + collapsible "Apps & System" section

**Problem:** the flat list shows ~97 ports, most of them daemons; and delicate
same-user system processes (ControlCenter, rapportd run as the user) currently render
an armed kill button like any dev server.

**Rust core (`ports/models.rs`, `ports/enrich.rs`):**

- Add `category: "dev" | "app" | "system"` to `PortEntry` (serde camelCase; mirror in
  `src/lib/types.ts` per the existing comment contract).
- Pure, unit-testable classifier using signals already collected:
  - `system` — owner uid != current uid (root, `_daemons`), OR binary path starts with
    `/System/`, `/usr/libexec/`, `/usr/sbin/`. Covers ControlCenter
    (`/System/Library/CoreServices`, runs as the user) and rapportd.
  - `app` — binary path contains a `*.app/` bundle segment (Discord, Raycast,
    Google Drive).
  - `dev` — everything else (typically has `cwd`/`project`; Homebrew PostgreSQL lands
    here, matching mockup 3a).

**Kill protection:**

- Backend guard is unchanged: `kill.rs` already refuses other users' pids.
- Renderer: `app`/`system` rows ALWAYS go through the two-step confirm ("Kill app?",
  grey ✕ instead of red) even when killable; root-owned rows keep the lock. `dev`
  rows keep today's behavior.

**Renderer UI (mockups 4a/4b):**

- Group the list: `N DEV` section on top (expanded), one `APPS & SYSTEM · N` row at
  the bottom, collapsed by default on every panel open (state not persisted).
- Expanded system rows: muted port numerals; show the `.app` bundle path instead of
  cwd (an app's cwd of "/" is meaningless).
- Search always searches ALL categories and auto-expands the section when it has
  matches. Footer becomes `83 ports · 4 dev`.

**Verify:** classifier unit tests per rule; UI: default open shows only dev rows +
folded section; searching "control" surfaces ControlCenter with grey confirm-only kill.

## F7 — Favourites tab (watched ports)

**Design (mockup 3b):**

- Tab bar `Listening | Favourites` with counts; always opens on Listening (tab state
  not persisted).
- Manual list persisted in `localStorage` key `chapay.favourites`:
  `[{ port: number, name?: string }]`. Added via `+ Watch a port` (port + optional
  name) or a "watch" action on any listening row.
- A favourite is a real row: when the port is **in use** it joins the live entry
  (label, folder, direct kill honoring F6 rules); when **free** it shows
  `nothing listening` plus its saved name ("1420 · Tauri dev") and a green dot.
- Footer on that tab: `4 watched · 2 in use`.

**Verify:** add/remove favourites survives app restart; free/in-use states flip live
as servers start/stop; kill from a favourite row behaves identically to Listening.

## Updated execution order

1. **F1** — remove tray tooltip (`fix/tray-tooltip-flicker`).
2. **F3 + F4 + F5** — renderer overlay hardening (`fix/native-overlay-hardening`).
3. **F2** — tray template icon, needs the design asset (`feat/tray-template-icon`).
4. **F6** — categories + collapsible section (`feat/port-categories`, Rust + renderer).
5. **F7** — favourites tab (`feat/favourites-tab`, renderer only).
