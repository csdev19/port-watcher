# F1 — remove the tray tooltip

**Status:** ready to implement; native causality remains to be verified.
**Dependency:** current baseline. Read [execution index](README.md).
**Goal:** no native tooltip saying “chapay” appears when hovering its menu-bar item.

## Evidence and scope

`apps/desktop/src-tauri/src/lib.rs`, `run()` setup, builds
`TrayIconBuilder::with_id("chapay-tray").tooltip("chapay")`.
The report describes the tooltip over the panel. That identifies its source, but does
not prove every residual vibration is caused by that tooltip or explain the compositor.
Keep this fix isolated so a native comparison is meaningful.

## Implementation

1. Start the current native app and capture whether hovering the tray after opening
   produces the tooltip. Record OS version, foreground app, fullscreen state and transparency.
2. Change the builder initialization to:
   ```rust
   let mut tray = TrayIconBuilder::with_id("chapay-tray");
   ```
3. Preserve the icon fallback until F2, tray ID, Quit menu, positioner call ordering,
   left-button-up event, global shortcut and hide-on-blur behavior.
4. Do not replace the tooltip with an empty string, renderer tooltip, notification or
   window title change. The tray builder should not configure a tooltip.

## Verification

- Run root `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`.
- Fully restart via root `bun run dev:desktop` so tray setup is recreated.
- Hover with panel closed, open it, leave the pointer over the tray for at least 3 seconds,
  move into the panel and out; repeat at least five times.
- Repeat over an ordinary opaque window and the originally reported transparent fullscreen cmux setup.
- Confirm no “chapay” tooltip, working left-click open/dismiss, right-click Quit menu and
  `⌥⌘P`. Do not quit until other interactions have been checked.

**Done:** native tooltip is absent and tray interactions remain functional. Record whether
the original flicker also disappeared. If it remains, report F1's tooltip removal as verified
and residual flicker as unresolved; do not silently expand into panel positioning or opacity.
No new automated test is needed for this one-line builder change.
