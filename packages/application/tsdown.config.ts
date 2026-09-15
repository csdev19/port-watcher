import { defineConfig } from "tsdown";

export default defineConfig({
  entry: { todos: "src/todos/index.ts" },

  exports: {
    devExports: true,
  },
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
