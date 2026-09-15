import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
  },
  // NOTE: exports are managed by hand in package.json (not `exports: devExports`)
  // because this package also ships a static `./css` subpath that tsdown's
  // exports generation would drop.
  format: ["esm"],
  outDir: "dist",
  clean: true,
  sourcemap: true,
  dts: true,
  external: [],
  target: "es2022",
  treeshake: true,
  minify: false,
});
