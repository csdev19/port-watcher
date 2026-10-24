import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { OUTPUTS, PANEL_OUTPUT, generateCss, generatePanelCss } from "./generate";

/**
 * The generated CSS is committed so consumers work on a fresh clone without a
 * codegen step. This guards it: editing a token in TS without re-running
 * `bun run generate` fails here with a clear message.
 */
describe("generated CSS is in sync with the TS source", () => {
  it.each(OUTPUTS)("css/$file matches generateCss('$prefix')", ({ file, prefix }) => {
    const committed = readFileSync(
      fileURLToPath(new URL(`../css/${file}`, import.meta.url)),
      "utf8",
    );
    expect(committed).toBe(generateCss(prefix));
  });
});

describe("generated panel CSS is in sync with the TS source", () => {
  it(`css/${PANEL_OUTPUT.file} matches generatePanelCss()`, () => {
    const committed = readFileSync(
      fileURLToPath(new URL(`../css/${PANEL_OUTPUT.file}`, import.meta.url)),
      "utf8",
    );
    expect(committed).toBe(generatePanelCss());
  });
});
