import { useCallback, useEffect, useState } from "react";
import type { CreateTodo, TodoBase, UpdateTodo } from "@monorepo-template/domain/schemas";

interface TodosState {
  todos: TodoBase[];
  loading: boolean;
  error: string | null;
}

/**
 * The renderer's whole data layer. Every call crosses IPC to the main process,
 * which runs the shared use cases against the local SQLite adapter — the
 * renderer never touches storage itself.
 *
 * Each mutation refetches rather than patching local state: the list is small,
 * on-device and instant, so the simpler code wins over optimistic updates.
 */
export function useTodos() {
  const [state, setState] = useState<TodosState>({ todos: [], loading: true, error: null });

  const refresh = useCallback(async () => {
    try {
      const todos = await window.api.todos.list();
      setState({ todos, loading: false, error: null });
    } catch (error) {
      setState({ todos: [], loading: false, error: (error as Error).message });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(
    async (input: CreateTodo) => {
      await window.api.todos.create(input);
      await refresh();
    },
    [refresh],
  );

  const update = useCallback(
    async (id: string, input: UpdateTodo) => {
      await window.api.todos.update(id, input);
      await refresh();
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      await window.api.todos.remove(id);
      await refresh();
    },
    [refresh],
  );

  return { ...state, refresh, create, update, remove };
}
