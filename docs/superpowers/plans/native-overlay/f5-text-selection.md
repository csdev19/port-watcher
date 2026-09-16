# F5 — prevent accidental chrome selection, preserve command copying

**Status:** ready. **Dependency:** verify together with F3/F4.
Read [execution index](README.md).

## Existing structure

`apps/desktop/src/app.module.css` defines `.panel`, `.row`, `.detail`, `.command` and
`.search`. `PortRow.tsx` puts details in a `dl`, not a code editor. No selection rules
exist today. The detail handler already stops click propagation, so selecting a command
should not collapse its row.

## Implementation

Add these declarations to the existing rules (do not duplicate entire blocks):

```css
/* .panel: interface chrome should not become a text selection. */
-webkit-user-select: none;
user-select: none;

/* .detail and .search: explicit exceptions to inherited WebKit behavior. */
-webkit-user-select: text;
user-select: text;
```

Apply the second pair to `.detail` and `.search` separately or in one grouped selector.
Making all details selectable lets users copy PID/user as well as command; normal row
labels, header and footer remain non-selectable. For F7, explicitly add its text inputs
to the same exception. Do not use global `dragstart`/`mousedown` prevention or CSS
`pointer-events: none`: they would interfere with controls and intentional copying.

Native drag from intentionally selectable details can still occur. This task reduces
accidental selection; it does not promise to eliminate all native drag overlays.

## Verification

From `apps/desktop`, run `bun run build`. Then use the native app:

1. Drag across port numbers, labels, the header and footer; no selection highlight appears.
2. Expand a row, select part and then all of its command, use `⌘C`, paste elsewhere and
   compare the actual string. Select and copy its PID too.
3. In search, drag-select a substring, use `⌘A`, replace it and paste a query. Caret and
   keyboard navigation still work.
4. Click clear, kill-arm/disarm on a mock or disposable dev row, expand/collapse, and scroll.
   No control should stop responding because of the CSS change.
5. Verify selection on packaged production with F4: right-click is absent, keyboard copy works.

**Done:** native WebKit selection matches these rules. jsdom cannot establish visual selection
or drag-image behavior; no new CSS-assertion test is needed.
