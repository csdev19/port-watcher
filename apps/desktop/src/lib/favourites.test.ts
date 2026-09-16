import { describe, expect, it } from "vitest";
import {
  duplicatePortMessage,
  normalizeName,
  parsePortInput,
  sanitizeFavourites,
} from "./favourites";

describe("parsePortInput", () => {
  it("accepts the boundaries", () => {
    expect(parsePortInput("1")).toBe(1);
    expect(parsePortInput("65535")).toBe(65535);
  });

  it("rejects out-of-range values", () => {
    expect(parsePortInput("0")).toBeNull();
    expect(parsePortInput("65536")).toBeNull();
  });

  it("rejects empty, signs, decimals, exponent notation, NaN, infinity", () => {
    expect(parsePortInput("")).toBeNull();
    expect(parsePortInput("   ")).toBeNull();
    expect(parsePortInput("-1")).toBeNull();
    expect(parsePortInput("+3000")).toBeNull();
    expect(parsePortInput("3000.5")).toBeNull();
    expect(parsePortInput("3e3")).toBeNull();
    expect(parsePortInput("NaN")).toBeNull();
    expect(parsePortInput("Infinity")).toBeNull();
  });

  it("trims whitespace and accepts digit-only input", () => {
    expect(parsePortInput("  3000  ")).toBe(3000);
  });

  it("normalizes leading zeros", () => {
    expect(parsePortInput("03000")).toBe(3000);
    expect(parsePortInput("00001")).toBe(1);
  });
});

describe("normalizeName", () => {
  it("returns undefined for undefined input", () => {
    expect(normalizeName(undefined)).toBeUndefined();
  });

  it("trims whitespace and omits when empty", () => {
    expect(normalizeName("  ")).toBeUndefined();
    expect(normalizeName("")).toBeUndefined();
    expect(normalizeName("  api  ")).toBe("api");
  });

  it("returns null when the trimmed name exceeds 80 characters", () => {
    expect(normalizeName("a".repeat(80))).toBe("a".repeat(80));
    expect(normalizeName("a".repeat(81))).toBeNull();
    expect(normalizeName(`  ${"a".repeat(81)}  `)).toBeNull();
  });
});

describe("duplicatePortMessage", () => {
  it("uses the exact contract wording", () => {
    expect(duplicatePortMessage(3000)).toBe("Port 3000 is already watched");
  });
});

describe("sanitizeFavourites", () => {
  it("absent/undefined -> empty list, not flagged as changed", () => {
    expect(sanitizeFavourites(undefined)).toEqual({ items: [], changed: false });
  });

  it("non-array root -> empty list, flagged as changed", () => {
    expect(sanitizeFavourites({ port: 3000 })).toEqual({ items: [], changed: true });
    expect(sanitizeFavourites("nope")).toEqual({ items: [], changed: true });
    expect(sanitizeFavourites(null)).toEqual({ items: [], changed: true });
  });

  it("empty array -> empty list, not changed", () => {
    expect(sanitizeFavourites([])).toEqual({ items: [], changed: false });
  });

  it("keeps valid records, preserving insertion order", () => {
    const input = [{ port: 3000 }, { port: 8080, name: "api" }];
    expect(sanitizeFavourites(input)).toEqual({
      items: [{ port: 3000 }, { port: 8080, name: "api" }],
      changed: false,
    });
  });

  it("discards invalid records (bad shape, out-of-range, non-integer port)", () => {
    const input = [
      { port: 3000 },
      "nope",
      null,
      { port: 0 },
      { port: 65536 },
      { port: 3000.5 },
      { noPort: true },
    ];
    expect(sanitizeFavourites(input)).toEqual({
      items: [{ port: 3000 }],
      changed: true,
    });
  });

  it("keeps the first valid occurrence of a duplicate stored port", () => {
    const input = [
      { port: 3000, name: "first" },
      { port: 3000, name: "second" },
    ];
    expect(sanitizeFavourites(input)).toEqual({
      items: [{ port: 3000, name: "first" }],
      changed: true,
    });
  });

  it("strips unknown fields while keeping the record", () => {
    const input = [{ port: 3000, name: "api", extra: "bogus" }];
    expect(sanitizeFavourites(input)).toEqual({
      items: [{ port: 3000, name: "api" }],
      changed: true,
    });
  });

  it("discards an invalid (too long / non-string) name but keeps the port", () => {
    const input = [
      { port: 3000, name: "a".repeat(81) },
      { port: 8080, name: 12345 },
    ];
    expect(sanitizeFavourites(input)).toEqual({
      items: [{ port: 3000 }, { port: 8080 }],
      changed: true,
    });
  });

  it("mixed valid and invalid records: keeps the valid ones, flags changed", () => {
    const input = [{ port: 3000 }, { port: "not a number" }, { port: 8080, name: "api" }];
    expect(sanitizeFavourites(input)).toEqual({
      items: [{ port: 3000 }, { port: 8080, name: "api" }],
      changed: true,
    });
  });
});
