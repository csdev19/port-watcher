import { join } from "node:path";
import { app, shell, BrowserWindow } from "electron";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import type { Locale } from "@monorepo-template/i18n";
import icon from "../../resources/icon.png?asset";
import { openDatabase } from "./infrastructure/database";
import { SettingsStore } from "./infrastructure/settings-store";
import { SqliteTodoRepository } from "./infrastructure/sqlite-todo.repository";
import { registerSettingsIpc } from "./ipc/settings.ipc";
import { registerTodosIpc } from "./ipc/todos.ipc";
import { createTray, type AppTray } from "./tray";

// Change this before shipping: it namespaces the app's data directory, the
// Windows taskbar grouping, and must match `appId` in electron-builder.yml.
const APP_ID = "com.example.desktop";

let tray: AppTray | null = null;
let quitting = false;

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1000,
    height: 720,
    minWidth: 640,
    minHeight: 480,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === "linux" ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      // Context isolation stays on (Electron's default) — the renderer reaches
      // the main process only through the bridge in src/preload.
      sandbox: false,
    },
  });

  window.on("ready-to-show", () => window.show());

  // Closing the window hides it instead of quitting: the tray stays alive, which
  // is what makes this a background-capable desktop app rather than a web page.
  window.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    window.hide();
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    // Never open an external URL inside the app's own window.
    void shell.openExternal(url);
    return { action: "deny" };
  });

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    void window.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return window;
}

/**
 * Composition root. Everything the app depends on is constructed here and passed
 * down explicitly — the use cases in `@monorepo-template/application` receive the
 * SQLite adapter, and nothing below this function knows where the data lives.
 */
function bootstrap(): void {
  const userData = app.getPath("userData");

  const settings = new SettingsStore(join(userData, "settings.json"));
  const database = openDatabase(join(userData, "app.db"));
  const repository = new SqliteTodoRepository(database);

  // Any settings change — from the renderer or from the tray itself — redraws
  // the native menu, so the two can never show different languages.
  const { apply } = registerSettingsIpc(settings, { onChanged: () => tray?.refresh() });
  registerTodosIpc(repository);

  const window = createWindow();

  tray = createTray({
    window,
    getSettings: () => settings.get(),
    onLocaleChange: (locale: Locale) => apply({ locale }),
    onQuit: () => app.quit(),
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) bootstrap();
    else window.show();
  });

  app.on("before-quit", () => {
    quitting = true;
    database.close();
  });
}

void app.whenReady().then(() => {
  electronApp.setAppUserModelId(APP_ID);

  // F12 toggles DevTools in dev; Cmd/Ctrl+R is ignored in production.
  app.on("browser-window-created", (_event, window) => optimizer.watchWindowShortcuts(window));

  bootstrap();
});

app.on("window-all-closed", () => {
  // The window only hides, so this fires on real teardown. macOS apps
  // conventionally stay resident until the user quits explicitly.
  if (process.platform !== "darwin") app.quit();
});
