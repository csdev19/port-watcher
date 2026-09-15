import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.tsx"],
    setupFiles: ["./src/vitest.setup.ts"],
  },
  resolve: {
    // Tests must use the workspace React, not the bundled `dist/` copy this
    // package ships. Without `development` + dedupe, `@base-ui/react` sees two
    // React instances and throws "Invalid hook call".
    conditions: ["development"],
    dedupe: ["react", "react-dom", "@base-ui/react"],
  },
});
