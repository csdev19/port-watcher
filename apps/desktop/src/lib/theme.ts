import { inTauri } from "./ports";

type Appearance = "light" | "dark";

/** Mirrors the macOS appearance onto `<html data-theme>` for the panel.
 *
 * The panel stylesheet already follows `prefers-color-scheme`; this is a
 * belt-and-braces path for a transparent Accessory-policy WKWebView that may
 * not re-evaluate the media query live. It reads the window theme once and
 * follows `onThemeChanged`. Any failure leaves `data-theme` unset, so the media
 * query keeps deciding. The Appearance setting (lib/appearance.ts) owns the attribute unless it is "system".
 *
 * Returns a cleanup function. */
export function syncPanelTheme(root: HTMLElement = document.documentElement): () => void {
  if (!inTauri) return () => {};
  let disposed = false;
  let unlisten: (() => void) | undefined;

  const apply = (theme: Appearance | null | undefined) => {
    if (disposed) return;
    if (theme === "light" || theme === "dark") root.dataset.theme = theme;
  };

  void (async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const win = getCurrentWindow();
      apply(await win.theme());
      const stop = await win.onThemeChanged(({ payload }) => apply(payload));
      if (disposed) stop();
      else unlisten = stop;
    } catch {
      // Permission missing or API unavailable: fall back to the media query.
    }
  })();

  return () => {
    disposed = true;
    unlisten?.();
  };
}
