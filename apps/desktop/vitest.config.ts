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
  },
});
