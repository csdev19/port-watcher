import { contextBridge, ipcRenderer } from "electron";
import { electronAPI } from "@electron-toolkit/preload";
import type { CreateTodo, UpdateTodo } from "@monorepo-template/domain/schemas";
import type { Locale } from "@monorepo-template/i18n";
import { IPC, type AppSettings, type DesktopApi, type ThemePreference } from "@shared/types";

/**
 * The whole surface the renderer gets. Each method is a thin `invoke` — no logic
 * here, because code in the preload runs with Node privileges and anything it
 * exposes is reachable from page scripts.
 */
const api: DesktopApi = {
  settings: {
    get: () => ipcRenderer.invoke(IPC.settings.get),
    setLocale: (locale: Locale) => ipcRenderer.invoke(IPC.settings.setLocale, locale),
    setTheme: (theme: ThemePreference) => ipcRenderer.invoke(IPC.settings.setTheme, theme),
    onChanged: (listener: (settings: AppSettings) => void) => {
      // Wrap the listener so the renderer never sees Electron's IpcRendererEvent,
      // and hand back an unsubscribe rather than exposing removeListener.
      const handler = (_event: unknown, settings: AppSettings): void => listener(settings);
      ipcRenderer.on(IPC.settings.changed, handler);
      return () => ipcRenderer.removeListener(IPC.settings.changed, handler);
    },
  },
  todos: {
    list: () => ipcRenderer.invoke(IPC.todos.list),
    create: (input: CreateTodo) => ipcRenderer.invoke(IPC.todos.create, input),
    update: (id: string, input: UpdateTodo) => ipcRenderer.invoke(IPC.todos.update, id, input),
    remove: (id: string) => ipcRenderer.invoke(IPC.todos.remove, id),
  },
};

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("electron", electronAPI);
    contextBridge.exposeInMainWorld("api", api);
  } catch (error) {
    console.error(error);
  }
} else {
  // Only reachable if contextIsolation is turned off, which this app does not do.
  // @ts-expect-error -- declared in index.d.ts, assigned here for the fallback path
  window.electron = electronAPI;
  // @ts-expect-error -- declared in index.d.ts, assigned here for the fallback path
  window.api = api;
}
