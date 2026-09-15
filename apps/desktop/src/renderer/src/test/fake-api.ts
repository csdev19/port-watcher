import type { CreateTodo, TodoBase, UpdateTodo } from "@monorepo-template/domain/schemas";
import type { AppSettings, DesktopApi, ThemePreference } from "@shared/types";
import type { Locale } from "@monorepo-template/i18n";

/**
 * An in-memory stand-in for the preload bridge.
 *
 * The renderer's only dependency is `window.api`, so faking that one object is
 * enough to test every screen without Electron, IPC or SQLite.
 */
export function installFakeApi(
  initial: { settings?: Partial<AppSettings>; todos?: TodoBase[] } = {},
): { settings: AppSettings; todos: TodoBase[] } {
  const state = {
    settings: { locale: "en", theme: "system", ...initial.settings } as AppSettings,
    todos: [...(initial.todos ?? [])],
  };
  const listeners = new Set<(settings: AppSettings) => void>();

  const notify = (): AppSettings => {
    for (const listener of listeners) listener(state.settings);
    return state.settings;
  };

  const api: DesktopApi = {
    settings: {
      get: async () => state.settings,
      setLocale: async (locale: Locale) => {
        state.settings = { ...state.settings, locale };
        return notify();
      },
      setTheme: async (theme: ThemePreference) => {
        state.settings = { ...state.settings, theme };
        return notify();
      },
      onChanged: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    todos: {
      list: async () => [...state.todos],
      create: async (input: CreateTodo) => {
        const now = new Date();
        const todo: TodoBase = {
          id: crypto.randomUUID(),
          title: input.title,
          completed: false,
          categoryId: input.categoryId ?? null,
          userId: "local-user",
          createdAt: now,
          updatedAt: now,
        };
        state.todos = [todo, ...state.todos];
        return todo;
      },
      update: async (id: string, input: UpdateTodo) => {
        const found = state.todos.find((todo) => todo.id === id);
        if (!found) return null;
        const next: TodoBase = { ...found, ...input, updatedAt: new Date() };
        state.todos = state.todos.map((todo) => (todo.id === id ? next : todo));
        return next;
      },
      remove: async (id: string) => {
        const before = state.todos.length;
        state.todos = state.todos.filter((todo) => todo.id !== id);
        return state.todos.length < before;
      },
    },
  };

  window.api = api;
  return state;
}
