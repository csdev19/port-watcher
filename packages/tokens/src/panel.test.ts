import { describe, expect, it } from "vitest";
import { generatePanelCss } from "./generate";
import { panelBase } from "./panel/base";
import { panelDark } from "./panel/dark";
import { panelLight } from "./panel/light";
import { PANEL_BASE_TOKEN_NAMES, PANEL_THEME_TOKEN_NAMES } from "./panel/types";

describe("panel tokens", () => {
  it("dark and light define exactly the same names", () => {
    expect(Object.keys(panelDark).sort()).toEqual([...PANEL_THEME_TOKEN_NAMES].sort());
    expect(Object.keys(panelLight).sort()).toEqual(Object.keys(panelDark).sort());
    expect(Object.keys(panelBase).sort()).toEqual([...PANEL_BASE_TOKEN_NAMES].sort());
  });

  it("keeps the brand colours out of the per-appearance set", () => {
    expect(PANEL_THEME_TOKEN_NAMES).not.toContain("pw-accent");
    expect(PANEL_THEME_TOKEN_NAMES).not.toContain("pw-action");
  });

  it("light darkens mint, yellow and danger as in design 7b", () => {
    expect(panelLight["pw-free"]).toBe("#0bae7b");
    expect(panelLight["pw-watched"]).toBe("#ffb020");
    expect(panelLight["status-danger"]).toBe("#e5484d");
    expect(panelLight["pw-surface"]).toBe("#ffffff");
    expect(panelLight["pw-band"]).toBe("#f5f5f7");
  });
});

describe("generatePanelCss", () => {
  const css = generatePanelCss();
  const rootBlock = css.slice(css.indexOf(":root {"), css.indexOf("@media"));
  const mediaBlock = css.slice(css.indexOf("@media"), css.indexOf(':root[data-theme="light"]'));
  const forcedLight = css.slice(css.indexOf(':root[data-theme="light"]'));

  it("declares dark values and the invariant tokens on :root", () => {
    for (const name of PANEL_THEME_TOKEN_NAMES) {
      expect(rootBlock).toContain(`--${name}: ${panelDark[name]};`);
    }
    for (const name of PANEL_BASE_TOKEN_NAMES) {
      expect(rootBlock).toContain(`--${name}: ${panelBase[name]};`);
    }
  });

  it("follows the system appearance only in every desktop window", () => {
    expect(mediaBlock).toContain("prefers-color-scheme: light");
    expect(mediaBlock).toContain(':root:not([data-theme="dark"])');
    for (const name of PANEL_THEME_TOKEN_NAMES) {
      expect(mediaBlock).toContain(`--${name}: ${panelLight[name]};`);
    }
  });

  it("lets data-theme=light force the light set in every desktop window", () => {
    for (const name of PANEL_THEME_TOKEN_NAMES) {
      expect(forcedLight).toContain(`--${name}: ${panelLight[name]};`);
    }
  });

  it("never re-declares the light set outside the light selectors", () => {
    const outside = css.replace(mediaBlock, "").replace(forcedLight, "");
    expect(outside).not.toContain(panelLight["pw-band-soft"]);
  });
});
