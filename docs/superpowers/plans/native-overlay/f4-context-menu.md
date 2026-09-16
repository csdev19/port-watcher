# F4 — suppress the production webview context menu

**Status:** ready. **Dependency:** implement with F3/F5.
Read [execution index](README.md).

## Scope and product tradeoff

Only the renderer's production `contextmenu` default is suppressed. The native tray Quit
menu is owned by Rust and remains available. Suppression also removes right-click Copy/Paste
in search and command text; keyboard `⌘C`/`⌘V` remains the supported path. This is an explicit
tradeoff of the original plan, not proof that all context menus cause flicker.

## Implementation

In `apps/desktop/src/App.tsx`, add one mount effect using its existing `useEffect` import:

```tsx
useEffect(() => {
  if (!import.meta.env.PROD) return;
  const preventContextMenu = (event: MouseEvent) => event.preventDefault();
  window.addEventListener("contextmenu", preventContextMenu);
  return () => window.removeEventListener("contextmenu", preventContextMenu);
}, []);
```

Use this location rather than a module-level listener in `main.tsx`: cleanup handles
unmount and React development lifecycle. Do not register both. Do not use `stopPropagation`,
prevent all mouse events, disable browser developer tools globally, or edit Tauri permissions.

## Verification

1. From `apps/desktop`, run `bun run check-types`, `bun run test`, `bun run build`.
2. Root `bun run dev:desktop`: secondary click / trackpad two-finger click still requests
   the development context menu. Existing hide-on-blur can hide the panel when Inspector
   takes focus; do not treat that pre-existing behavior as a new regression.
3. Root `bun run build:desktop`: launch the packaged production app. Secondary-click the
   empty background, a row, search input and expanded command. No webview context menu appears.
4. Select command text and use `⌘C`, then paste into a separate editor. Search still accepts
   pasted text. Right-clicking the tray still exposes Quit.

**Done:** production suppression and development preservation are both observed. Vite dev
alone cannot exercise the production guard. If unit coverage is added, stub `PROD` per test,
dispatch a cancelable `contextmenu`, assert `defaultPrevented` in production and its absence
in development, unmount and verify cleanup; restore the environment after each test.
