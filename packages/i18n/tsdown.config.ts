import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    web: "src/web.ts",
    core: "src/core.ts",
  },
  // NOTE: exports are managed by hand in package.json (not `exports: devExports`)
  // because this package ships static `./messages/*` subpaths that tsdown's
  // exports generation would drop.
  format: ["esm"],
  outDir: "dist",
  clean: true,
  sourcemap: true,
  dts: true,
  external: ["react", "use-intl"],
  target: "es2022",
  treeshake: true,
  minify: false,
});
