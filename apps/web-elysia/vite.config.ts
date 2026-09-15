import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [
    tailwindcss(),
    tsconfigPaths(),
    tanstackStart(),
    cloudflare({ viteEnvironment: { name: "ssr" }, inspectorPort: 9235 }),
    viteReact(),
  ],
  server: {
    port: 3003,
  },
  // optimizeDeps: {
  //   force: true,
  // },
  // css: {
  //   devSourcemap: true,
  // },
  // build: {
  //   cssCodeSplit: false,
  // },
});
