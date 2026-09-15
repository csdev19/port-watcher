import type { CreateTodo, TodoBase, UpdateTodo } from "@monorepo-template/domain/schemas";
import type { Locale } from "@monorepo-template/i18n";
import type { AppSettings, ThemePreference } from "./settings";

/**
 * The surface the preload bridge exposes on `window.api`. This is the app's real
 * boundary: the renderer never touches Node, the filesystem or the database — it
 * only calls these methods.
 */
export interface DesktopApi {
  settings: {
    get(): Promise<AppSettings>;
    setLocale(locale: Locale): Promise<AppSettings>;
    setTheme(theme: ThemePreference): Promise<AppSettings>;
    /** Subscribe to changes made outside the renderer. Returns an unsubscribe. */
    onChanged(listener: (settings: AppSettings) => void): () => void;
  };
  todos: {
    list(): Promise<TodoBase[]>;
    create(input: CreateTodo): Promise<TodoBase>;
    update(id: string, input: UpdateTodo): Promise<TodoBase | null>;
    remove(id: string): Promise<boolean>;
  };
}
