import { describe, expect, it } from "vitest";
import {
  duplicatePortMessage,
  joinFavourites,
  normalizeName,
  parsePortInput,
  sanitizeFavourites,
} from "./favourites";
import { MOCK_PORTS } from "./mock-ports";
import type { PortEntry } from "./types";

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

  it("returns null when the trimmed name exceeds 30 characters", () => {
    expect(normalizeName("a".repeat(30))).toBe("a".repeat(30));
    expect(normalizeName("a".repeat(31))).toBeNull();
    expect(normalizeName(`  ${"a".repeat(31)}  `)).toBeNull();
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

describe("joinFavourites", () => {
  const entry = (overrides: Partial<PortEntry>): PortEntry => ({
    ...MOCK_PORTS[0],
    ...overrides,
  });

  it("a favourite with zero listeners maps to an empty listeners array", () => {
    const result = joinFavourites([{ port: 9999 }], MOCK_PORTS);
    expect(result).toEqual([{ favourite: { port: 9999 }, listeners: [] }]);
  });

  it("a favourite with one listener maps to a single-row listeners array", () => {
    const result = joinFavourites([{ port: 3000 }], MOCK_PORTS);
    expect(result).toEqual([
      { favourite: { port: 3000 }, listeners: [MOCK_PORTS.find((e) => e.port === 3000)] },
    ]);
  });

  it("two PIDs on one watched port: both listener rows are returned, in snapshot order", () => {
    const a = entry({ port: 4000, pid: 1, processName: "first" });
    const b = entry({ port: 4000, pid: 2, processName: "second" });
    const result = joinFavourites([{ port: 4000 }], [a, b]);
    expect(result).toEqual([{ favourite: { port: 4000 }, listeners: [a, b] }]);
  });

  it("one PID listening on two watched ports appears under both favourites", () => {
    const a = entry({ port: 4000, pid: 7 });
    const b = entry({ port: 5000, pid: 7 });
    const result = joinFavourites([{ port: 4000 }, { port: 5000 }], [a, b]);
    expect(result).toEqual([
      { favourite: { port: 4000 }, listeners: [a] },
      { favourite: { port: 5000 }, listeners: [b] },
    ]);
  });

  it("preserves the saved favourites order, independent of snapshot order", () => {
    const items = [{ port: 8787 }, { port: 3000 }, { port: 5432 }];
    const result = joinFavourites(items, MOCK_PORTS);
    expect(result.map((m) => m.favourite.port)).toEqual([8787, 3000, 5432]);
  });

  it("reflects current live metadata, never a prior run's persisted fields", () => {
    const staleFavourite = { port: 3000, name: "old saved name" };
    const freshEntry = entry({
      port: 3000,
      pid: 999,
      processName: "totally-different",
      label: "New process",
    });
    const result = joinFavourites([staleFavourite], [freshEntry]);
    expect(result[0].listeners).toEqual([freshEntry]);
    expect(result[0].listeners[0].label).toBe("New process");
    // The favourite's own saved fields are untouched by the join.
    expect(result[0].favourite).toEqual(staleFavourite);
  });

  it("does not mutate the input items or entries arrays/objects", () => {
    const items = [{ port: 3000, name: "api" }];
    const entries = [entry({ port: 3000 })];
    const itemsSnapshot = JSON.parse(JSON.stringify(items));
    const entriesSnapshot = JSON.parse(JSON.stringify(entries));

    joinFavourites(items, entries);

    expect(items).toEqual(itemsSnapshot);
    expect(entries).toEqual(entriesSnapshot);
  });

  it("empty favourites list yields an empty result regardless of snapshot", () => {
    expect(joinFavourites([], MOCK_PORTS)).toEqual([]);
  });

  it("empty snapshot yields every favourite with zero listeners", () => {
    const result = joinFavourites([{ port: 3000 }, { port: 8080 }], []);
    expect(result).toEqual([
      { favourite: { port: 3000 }, listeners: [] },
      { favourite: { port: 8080 }, listeners: [] },
    ]);
  });
});
