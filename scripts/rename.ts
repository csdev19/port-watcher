#!/usr/bin/env bun
/**
 * Rename the @monorepo-template scope across the entire project.
 *
 * Usage: bun run rename <new-scope>
 * Example: bun run rename raiko  ->  @monorepo-template becomes @raiko
 *
 * Flags:
 *   --skip-install  Skip running `bun install` after rename
 */

import { readFileSync, writeFileSync, statSync } from "node:fs";
import path from "node:path";

const OLD_SCOPE = "@monorepo-template";
const OLD_NAME = "monorepo-template";

const EXCLUDE = new Set([
  "node_modules",
  ".git",
  "bun.lock",
  "bun.lockb",
  ".turbo",
  "dist",
  // electron-vite's build output. Without this, running rename after a desktop
  // build rewrites the bundled JS in place.
  "out",
  ".output",
  ".wrangler",
  ".next",
]);

const ROOT = path.resolve(import.meta.dir, "..");

async function main() {
  const args = process.argv.slice(2);
  const skipInstall = args.includes("--skip-install");
  const input = args.find((a) => !a.startsWith("--"));

  if (!input) {
    console.error("Usage: bun run rename <new-scope>");
    console.error("Example: bun run rename raiko");
    process.exit(1);
  }

  const newScope = input.startsWith("@") ? input : `@${input}`;
  const newName = newScope.slice(1);

  console.log(`\nRenaming: ${OLD_SCOPE} -> ${newScope}`);
  console.log(`Also:     ${OLD_NAME} -> ${newName}\n`);

  const changed: string[] = [];
  const glob = new Bun.Glob("**/*");

  // `dot: true` is essential: the scope lives in dotfiles too (.env.example,
  // .claude/*, .cursor/*). Without it the glob silently skips them and leaves
  // stale @monorepo-template references behind.
  for await (const relative of glob.scan({ cwd: ROOT, dot: true })) {
    const parts = relative.split("/");
    if (parts.some((p) => EXCLUDE.has(p))) continue;

    const full = path.join(ROOT, relative);

    try {
      if (statSync(full).isDirectory()) continue;
    } catch {
      continue;
    }

    try {
      const content = readFileSync(full, "utf-8");
      if (!content.includes(OLD_SCOPE) && !content.includes(OLD_NAME)) continue;

      const updated = content.replaceAll(OLD_SCOPE, newScope).replaceAll(OLD_NAME, newName);
      writeFileSync(full, updated);
      changed.push(relative);
    } catch {
      continue;
    }
  }

  console.log(`Updated ${changed.length} files:\n`);
  for (const f of changed.sort()) {
    console.log(`  ${f}`);
  }

  if (!skipInstall) {
    console.log("\nRunning bun install to update lockfile...");
    const proc = Bun.spawn(["bun", "install"], {
      cwd: ROOT,
      stdout: "inherit",
      stderr: "inherit",
    });
    await proc.exited;
  }

  console.log(`\nDone! Scope renamed to ${newScope}`);
}

main();
