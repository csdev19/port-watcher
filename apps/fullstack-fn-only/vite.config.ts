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
    tanstackStart({
      // Auth (better-auth) and the todos demo are disabled until the web app
      // needs accounts: nothing in chapay uses them yet, and they would make
      // the landing depend on DATABASE_URL and BETTER_AUTH_*. The route files
      // stay in the tree, only unregistered; the code they use is excluded in
      // tsconfig.json. Remove this pattern (and that exclude) to bring them back.
      router: { routeFileIgnorePattern: "^(auth|api|_authenticated)(\\.tsx)?$" },
    }),
    cloudflare({ viteEnvironment: { name: "ssr" }, inspectorPort: 9232 }),
    viteReact(),
  ],
  server: {
    port: 3002,
  },
});
