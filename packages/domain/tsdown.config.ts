import { defineConfig } from "tsdown";

export default defineConfig({
  // Entry points for each domain layer
  entry: {
    constants: "src/constants/index.ts",
    types: "src/types/index.ts",
    schemas: "src/schemas/index.ts",
    repositories: "src/repositories/index.ts",
    // Test fixtures (builders), consumed by other packages' tests as
    // `@monorepo-template/domain/testing`. tsdown owns the exports map via
    // `devExports`, so a subpath only survives if it is an entry here.
    testing: "src/testing/index.ts",
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
