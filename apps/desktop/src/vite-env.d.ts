/// <reference types="vite/client" />

/** Short git commit the renderer was built from ("dev" without git). Set by `define` in vite.config.ts. */
declare const __COMMIT__: string;

/** Side-effect stylesheet import; the package export resolves to a .css file. */
declare module "@port-watcher/tokens/css/panel";
