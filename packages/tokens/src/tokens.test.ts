import { describe, expect, it } from "vitest";
import { dark } from "./themes/dark";
import { light } from "./themes/light";
import { THEME_TOKEN_NAMES } from "./types";

describe("theme parity", () => {
  it("light and dark define exactly the theme token set", () => {
    const expected = [...THEME_TOKEN_NAMES].sort();
    expect(Object.keys(light).sort()).toEqual(expected);
    expect(Object.keys(dark).sort()).toEqual(expected);
  });

  it("no token is an empty string", () => {
    for (const name of THEME_TOKEN_NAMES) {
      expect(light[name].length).toBeGreaterThan(0);
      expect(dark[name].length).toBeGreaterThan(0);
    }
  });
});
