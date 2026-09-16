# F2 — ship a real macOS template tray icon

**Status:** implementation specified; final artwork review is outstanding.
**Dependency:** integrate F1 before editing the same setup block.
Read [execution index](README.md).

## Existing code and intended result

`apps/desktop/src-tauri/src/lib.rs` uses `app.default_window_icon()` and explicitly defers
template rendering. Renderer Lucide icons do not affect this native image.
The bundle/application icon must remain separate from the menu-bar template.

## Files

- New `apps/desktop/src-tauri/icons/tray-icon.svg`: editable monochrome source.
- New `apps/desktop/src-tauri/icons/tray-icon.png`: 22 × 22 pixels baseline raster.
- Optional new `tray-icon@2x.png`: 44 × 44 pixels only if an explicit scale-aware loading
  path is implemented and verified. Do not claim automatic `@2x` resolution from `include_bytes!`.
- Existing `apps/desktop/src-tauri/Cargo.toml`, `src/lib.rs`; Cargo lockfile only if resolution changes.

## Slice 1 — prepare and review artwork

1. Inspect existing icon assets and the product design brief before choosing a glyph.
   Use a recognizable simplified chapay mark; if no suitable source exists, request artwork
   approval rather than inventing a final brand decision.
2. Use a 22-unit square source canvas, approximately 2 units transparent padding and shapes
   legible around 18 units. No baked background, colored pixels, shadow or wordmark.
3. Rasterize black RGB with alpha (antialiasing may use partial alpha). Record the export tool
   and command/settings in a short adjacent English asset README so output can be reproduced.
4. Inspect at actual menu-bar size, not only enlarged. Commit source with the raster when
   the user authorizes the implementation commit.

## Slice 2 — decode and wire

1. Tauri's `Image::from_bytes` is feature-gated for supported formats. Add `image-png` to
   the existing `tauri` feature array; retain `tray-icon` and `macos-private-api`.
2. Replace the default-window-icon conditional and obsolete comment with embedded decoding:
   ```rust
   let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray-icon.png"))?;
   let tray = TrayIconBuilder::with_id("chapay-tray")
       .icon(icon)
       .icon_as_template(true);
   ```
   Keep the subsequent menu/event chain intact. `mut` is no longer needed if the builder is
   created in this form. Do not restore F1's tooltip.
3. A missing embedded file is a compile error; invalid bytes should fail setup through `?`.
   Do not silently revert to the colored bundle icon and call the work complete.
4. Keep `tauri.conf.json` bundle icons unchanged. Embedded bytes need no runtime resource lookup.

## Scale acceptance and stop condition

The snippet loads one raster, not a Cocoa multi-representation image. Verify the actual
logical footprint and sharpness on Retina and, when available, a 1× external display.
If 22px is too soft or 44px changes the logical size, inspect the pinned Tauri/tray-icon
API before selecting another loader. Record that as a specific unresolved scale issue;
do not introduce an unreviewed Objective-C dependency to complete this task.

## Checks

From root run `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`,
`cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --check`, and
`bun run build:desktop`. Launch the built app.

Acceptance: native tray glyph is monochrome, adapts in light and dark menu bars, has no
opaque square, is centered and legible, preserves click target/anchoring, and the app bundle
icon stays unchanged. Report display scales actually checked and artwork approval status.
