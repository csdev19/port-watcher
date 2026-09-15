import { defineConfig } from "tsdown";

export default defineConfig({
  // Entry points for each domain layer
  entry: {
    schemas: "src/schema/index.ts",
    client: "src/client/index.ts",
    repositories: "src/repositories/index.ts",
  },

  exports: {
    devExports: true,
  },
  // Output formats
  format: ["esm"],

  // Output settings
  outDir: "dist",
  clean: true,
  sourcemap: true,

  // TypeScript settings
  dts: true, // Generate .d.ts files

  // External dependencies (don't bundle these)
  external: [],

  // Target environment
  target: "es2022",

  // Bundle settings
  treeshake: true,
  minify: false, // Keep readable for library distribution
});
