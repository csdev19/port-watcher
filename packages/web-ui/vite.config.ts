import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import dts from "vite-plugin-dts";
import { resolve } from "node:path";
import tsconfigPaths from "vite-tsconfig-paths";
import { libInjectCss } from "vite-plugin-lib-inject-css";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [
    tsconfigPaths(),
    react(),
    dts({
      entryRoot: "src",
      outDir: "dist",
      insertTypesEntry: true,
    }),
    libInjectCss(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
  build: {
    lib: {
      entry: "src/index.ts",
      name: "WebUI",
      fileName: (format) => `index.${format}.js`,
      formats: ["es"],
    },
    rollupOptions: {
      external: ["react", "react-dom", "react-markdown", "remark-gfm"],
      // Why does Style Code Injection Fail?
      // Source: https://www.npmjs.com/package/vite-plugin-lib-inject-css
      output: {
        preserveModules: false,
      },
    },
    sourcemap: true,
    outDir: "dist",
    emptyOutDir: true,
    // there's no necessity to minify the css since the apps are going to minify the css, but is going to improve the legibility of the css
    minify: false,
    // we don't want to charge all the css for components that are not going to be used
    cssCodeSplit: true,
  },
});
