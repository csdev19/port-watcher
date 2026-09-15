import { useEffect } from "react";

/**
 * Toggles the `.dark` class that `@monorepo-template/tokens` keys its dark
 * palette on.
 *
 * There is deliberately no branch on the stored preference here: the main
 * process sets `nativeTheme.themeSource` from it, and Electron makes the
 * renderer's `prefers-color-scheme` follow that. So "system", "light" and "dark"
 * all arrive through the same media query, and the OS-level change is picked up
 * for free.
 */
export function ThemeEffect() {
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");

    const apply = (): void => {
      document.documentElement.classList.toggle("dark", query.matches);
    };

    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  return null;
}
