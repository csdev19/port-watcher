import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import es from "../../messages/es.json";

/** Flatten a nested catalog into dotted keys: { a: { b: "x" } } → ["a.b"]. */
function keysOf(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    return v && typeof v === "object" ? keysOf(v as Record<string, unknown>, key) : [key];
  });
}

/** Guards against missing/extra/empty translations reaching runtime. */
describe("message catalog parity (en is the source of truth)", () => {
  const enKeys = keysOf(en).sort();
  const esKeys = keysOf(es).sort();

  it("es defines exactly the same keys as en", () => {
    expect(esKeys).toEqual(enKeys);
  });

  it("no translation is an empty string", () => {
    for (const catalog of [en, es]) {
      for (const key of keysOf(catalog)) {
        const value = key
          .split(".")
          .reduce<unknown>((acc, k) => (acc as Record<string, unknown>)[k], catalog);
        expect(typeof value === "string" && value.length > 0, `empty: ${key}`).toBe(true);
      }
    }
  });
});
