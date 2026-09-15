import { resolve } from "path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const alias = {
  "@shared": resolve(import.meta.dirname, "src/shared"),
  "@renderer": resolve(import.meta.dirname, "src/renderer/src"),
};

// Mirrors electron.vite.config.ts: the workspace packages under test resolve
// React from the workspace root, this app pins its own, and two copies break
// every hook. See the comment there.
const DEDUPE = ["react", "react-dom"];

/**
 * Two suites in one run. The main-process code is plain Node (SQLite, fs), the
 * renderer needs a DOM — so they are separate projects rather than one config
 * with a shared environment.
 */
export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "main",
          environment: "node",
          include: ["src/{main,preload,shared}/**/*.{test,spec}.ts"],
        },
      },
      {
        plugins: [react()],
        resolve: { alias, dedupe: DEDUPE },
        test: {
          name: "renderer",
          environment: "jsdom",
          globals: true,
          setupFiles: ["./src/renderer/src/test/setup.ts"],
          include: ["src/renderer/**/*.{test,spec}.{ts,tsx}"],
          server: {
            deps: {
              // Vitest externalizes node_modules by default, so `use-intl` (a
              // dependency of packages/i18n) would resolve React through Node and
              // pick up i18n's own hoisted copy — a second React, and every hook
              // throws. Inlining routes it through Vite, where `dedupe` applies.
              // A real build already bundles it, so this is a test-only concern.
              inline: [/use-intl/],
            },
          },
        },
      },
    ],
  },
});
