import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { SettingsStore } from "./settings-store";

describe("SettingsStore", () => {
  let filePath: string;

  beforeEach(() => {
    filePath = join(mkdtempSync(join(tmpdir(), "desktop-settings-")), "settings.json");
  });

  it("starts from defaults when no file exists", () => {
    expect(new SettingsStore(filePath).get()).toEqual({ locale: "en", theme: "system" });
  });

  it("persists an update and reloads it in a new instance", () => {
    new SettingsStore(filePath).update({ locale: "es", theme: "dark" });

    expect(new SettingsStore(filePath).get()).toEqual({ locale: "es", theme: "dark" });
  });

  it("merges a partial update instead of replacing the file", () => {
    const store = new SettingsStore(filePath);
    store.update({ theme: "light" });

    expect(store.update({ locale: "es" })).toEqual({ locale: "es", theme: "light" });
  });

  it("falls back to defaults when the file is corrupt rather than throwing", () => {
    writeFileSync(filePath, "{ not json");

    expect(new SettingsStore(filePath).get()).toEqual({ locale: "en", theme: "system" });
  });

  it("repairs unknown values field by field", () => {
    writeFileSync(filePath, JSON.stringify({ locale: "fr", theme: "neon" }));

    expect(new SettingsStore(filePath).get()).toEqual({ locale: "en", theme: "system" });
  });

  it("normalizes a region locale to its supported base", () => {
    writeFileSync(filePath, JSON.stringify({ locale: "es-419", theme: "dark" }));

    expect(new SettingsStore(filePath).get()).toEqual({ locale: "es", theme: "dark" });
  });

  it("hands out copies, so a caller cannot mutate the cache", () => {
    const store = new SettingsStore(filePath);
    store.get().theme = "dark";

    expect(store.get().theme).toBe("system");
  });

  it("writes valid JSON to disk", () => {
    new SettingsStore(filePath).update({ locale: "es" });

    expect(JSON.parse(readFileSync(filePath, "utf8"))).toEqual({ locale: "es", theme: "system" });
  });
});
