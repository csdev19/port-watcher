import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/test/**/*.test.ts"],
    environment: "node",
    // Serial: several workers creating users on one shared branch would collide
    // on unique constraints.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      // The real module only exists in workerd; point it at the process.env stub
      // so `src/env.ts` runs under Node.
      "cloudflare:workers": fileURLToPath(
        new URL("src/test/cloudflare-workers-stub.ts", import.meta.url),
      ),
    },
  },
});
