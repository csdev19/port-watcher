// @vitest-environment node
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";

/*
 * scripts/updater-feed.sh writes and guards updates/latest.json in the
 * release workflow. Its output must match scripts/fixtures/latest.json, which
 * the Rust tests parse with tauri-plugin-updater's own release type.
 */

const SCRIPT = fileURLToPath(new URL("./updater-feed.sh", import.meta.url));
const FIXTURE = fileURLToPath(new URL("./fixtures/latest.json", import.meta.url));
const BASE = "https://downloads.example.com";
const NOTES = "chapay 0.2.1: https://github.com/csdev19/port-watcher/releases/tag/desktop-v0.2.1";

let dir: string;

function run(...args: string[]): string {
  return execFileSync("sh", [SCRIPT, ...args], { encoding: "utf8", stdio: "pipe" });
}

function fails(...args: string[]): string {
  try {
    run(...args);
  } catch (error) {
    return String((error as { stderr?: string }).stderr);
  }
  throw new Error(`expected failure: ${args.join(" ")}`);
}

function file(name: string, contents: string): string {
  const path = join(dir, name);
  writeFileSync(path, contents);
  return path;
}

function writeFeed(version = "0.2.1", base = BASE): string {
  // `tauri bundle` writes the .sig without a trailing newline; tolerate one.
  const arm = file("arm.sig", "c2lnLWFybTY0\n");
  const x64 = file("x64.sig", "c2lnLXg2NA==");
  return run("write", version, base, NOTES, "2026-11-01T12:00:00Z", arm, x64);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "chapay-feed-"));
});

describe("updater-feed.sh write", () => {
  it("writes exactly the fixture the Rust side parses", () => {
    expect(JSON.parse(writeFeed())).toEqual(JSON.parse(readFileSync(FIXTURE, "utf8")));
  });

  it("drops a trailing slash from the base URL", () => {
    expect(JSON.parse(writeFeed("0.2.1", `${BASE}/`))).toEqual(
      JSON.parse(readFileSync(FIXTURE, "utf8")),
    );
  });

  it("refuses a non-HTTPS base, a non X.Y.Z version and a missing signature", () => {
    const sig = file("ok.sig", "c2ln");
    expect(fails("write", "0.2.1", "http://x.dev", NOTES, "d", sig, sig)).toMatch(/https/);
    expect(fails("write", "0.2.1-beta.1", BASE, NOTES, "d", sig, sig)).toMatch(/X\.Y\.Z/);
    expect(fails("write", "0.2.1", BASE, NOTES, "d", sig, join(dir, "nope.sig"))).toMatch(
      /signature/,
    );
    expect(fails("write", "0.2.1", BASE, NOTES, "d", sig, file("empty.sig", ""))).toMatch(
      /signature/,
    );
  });
});

describe("updater-feed.sh validate", () => {
  it("accepts the feed it wrote", () => {
    const feed = file("latest.json", writeFeed());
    expect(() => run("validate", feed, "0.2.1", BASE)).not.toThrow();
  });

  it("refuses a feed for another version, host or with a platform missing", () => {
    const good = JSON.parse(writeFeed());
    const feed = file("latest.json", JSON.stringify(good));
    expect(fails("validate", feed, "0.2.2", BASE)).toMatch(/not a valid feed/);
    expect(fails("validate", feed, "0.2.1", "https://other.example.com")).toMatch(/not a valid/);

    delete good.platforms["darwin-x86_64"];
    const partial = file("partial.json", JSON.stringify(good));
    expect(fails("validate", partial, "0.2.1", BASE)).toMatch(/not a valid feed/);
  });

  it("refuses an empty signature", () => {
    const feed = JSON.parse(writeFeed());
    feed.platforms["darwin-aarch64"].signature = "";
    expect(fails("validate", file("bad.json", JSON.stringify(feed)), "0.2.1", BASE)).toMatch(
      /not a valid feed/,
    );
  });
});

describe("updater-feed.sh compare", () => {
  const live = (version: string) => file("live.json", JSON.stringify({ version }));

  it("publishes the first feed and any newer version", () => {
    expect(run("compare", file("none.json", ""), "0.2.0").trim()).toBe("publish");
    expect(run("compare", live("0.2.0"), "0.2.1").trim()).toBe("publish");
    // Numeric, not string, order.
    expect(run("compare", live("0.9.0"), "0.10.0").trim()).toBe("publish");
  });

  it("republishes the same version, so a re-signed rerun keeps feed and archive in step", () => {
    expect(run("compare", live("0.2.1"), "0.2.1").trim()).toBe("republish");
  });

  it("never moves the feed backwards", () => {
    expect(fails("compare", live("0.3.0"), "0.2.9")).toMatch(/refusing to move it backwards/);
    expect(fails("compare", live("0.10.0"), "0.9.0")).toMatch(/backwards/);
  });

  it("fails on a live feed it cannot read", () => {
    expect(fails("compare", file("junk.json", "<html>"), "0.2.1")).toMatch(/not JSON|no X\.Y\.Z/);
    expect(fails("compare", live("latest"), "0.2.1")).toMatch(/no X\.Y\.Z/);
  });
});
