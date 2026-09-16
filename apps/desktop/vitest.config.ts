import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // package.json is "type": "module", so no __dirname here.
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    // No tests exist yet in this task; later tasks in the plan add them.
    // Vitest 4 exits non-zero on an empty suite by default.
    passWithNoTests: true,
    // @testing-library/react's auto-cleanup-after-each only registers
    // itself when it finds a global `afterEach` (it checks globalThis at
    // import time) — without this, DOM from one PortRow test leaks into
    // the next and role/text queries start matching multiple elements.
    globals: true,
  },
});
