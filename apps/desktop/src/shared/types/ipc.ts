/**
 * Every IPC channel the app uses, in one place. The main process registers these
 * names and the preload bridge consumes them, so a typo shows up as a type error
 * rather than a silently dead handler.
 */
export const IPC = {
  settings: {
    get: "settings:get",
    setLocale: "settings:set-locale",
    setTheme: "settings:set-theme",
    /** main -> renderer, broadcast whenever settings change (e.g. from the tray). */
    changed: "settings:changed",
  },
  todos: {
    list: "todos:list",
    create: "todos:create",
    update: "todos:update",
    remove: "todos:remove",
  },
} as const;
