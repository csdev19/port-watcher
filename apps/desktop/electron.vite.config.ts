import { resolve } from "path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

// `externalizeDepsPlugin` externalizes exactly what package.json lists under
// `dependencies`, and electron-builder packages exactly that too. Everything else
// is bundled into out/.
//
// That is why the `@monorepo-template/*` packages sit in devDependencies: they
// export raw TypeScript from `./src/*.ts` with no `dist`, so externalizing them
// would leave Node trying to `require` a .ts file at runtime. Bundling them also
// keeps the app's source out of the shipped asar. Only real, publishable runtime
// deps (electron-updater, zod, @electron-toolkit/*) belong in `dependencies`.
const alias = {
  "@shared": resolve("src/shared"),
};

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
  },
  renderer: {
    resolve: {
      alias: {
        ...alias,
        "@renderer": resolve("src/renderer/src"),
      },
      // This app pins React exactly while the workspace packages it renders
      // (i18n's provider) declare a `^19` peer that hoists to a different patch.
      // Without deduping, two Reacts end up in the bundle and every hook throws.
      dedupe: ["react", "react-dom"],
    },
    plugins: [react()],
  },
});
