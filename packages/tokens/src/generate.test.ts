import { describe, expect, it } from "vitest";
import { base } from "./base";
import { generateCss } from "./generate";
import { dark } from "./themes/dark";
import { light } from "./themes/light";
import { BASE_TOKEN_NAMES, THEME_TOKEN_NAMES } from "./types";

describe("generateCss", () => {
  const css = generateCss();

  it("emits a :root block with the light theme + base tokens", () => {
    for (const name of THEME_TOKEN_NAMES) {
      expect(css).toContain(`--mt-${name}: ${light[name]};`);
    }
    for (const name of BASE_TOKEN_NAMES) {
      expect(css).toContain(`--mt-${name}: ${base[name]};`);
    }
  });

  it("emits a .dark block re-declaring the dark theme colors", () => {
    const darkBlock = css.slice(css.indexOf(".dark {"));
    for (const name of THEME_TOKEN_NAMES) {
      expect(darkBlock).toContain(`--mt-${name}: ${dark[name]};`);
    }
  });

  it("prefixes every custom property so it never shadows shadcn's vars", () => {
    const declarations = css.match(/^\s*--[\w-]+:/gm) ?? [];
    expect(declarations.length).toBeGreaterThan(0);
    for (const decl of declarations) {
      expect(decl.trim()).toMatch(/^--mt-/);
    }
  });

  it("supports an empty prefix (e.g. for a non-shadcn consumer)", () => {
    const unprefixed = generateCss("");
    expect(unprefixed).toContain(`--background: ${light.background};`);
  });
});
