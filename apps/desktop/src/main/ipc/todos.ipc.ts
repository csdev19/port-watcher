import { ipcMain } from "electron";
import { createTodo, deleteTodo, listTodos, updateTodo } from "@monorepo-template/application";
import type { ITodoRepository } from "@monorepo-template/domain/repositories";
import { unwrap } from "@monorepo-template/domain/types";
import { createTodoSchema, updateTodoSchema } from "@monorepo-template/domain/schemas";
import { IPC } from "@shared/types";
import { LOCAL_USER_ID } from "../local-user";

/**
 * One page is enough for a local list; a real app would surface pagination in the
 * UI. 100 is the ceiling `paginationQuerySchema` allows, so staying at it keeps
 * this call valid against the same contract the HTTP API validates.
 */
const LIST_PAGE_SIZE = 100;

/**
 * The IPC layer is a driving adapter: it validates what arrives from the
 * renderer, then delegates to the shared use cases. No business logic lives here
 * — that is what makes this app and the server share `@monorepo-template/application`.
 */
export function registerTodosIpc(repository: ITodoRepository): void {
  ipcMain.handle(IPC.todos.list, async () => {
    const result = await listTodos({
      repo: repository,
      userId: LOCAL_USER_ID,
      pagination: { page: 1, limit: LIST_PAGE_SIZE },
    });
    // `unwrap` rethrows the Result's error; the preload bridge turns a rejected
    // handler into a rejected promise in the renderer.
    return unwrap(result).data;
  });

  ipcMain.handle(IPC.todos.create, async (_event, input: unknown) => {
    // Trust nothing from the renderer, even though we wrote it: the domain
    // schema is the same one the server validates with.
    const data = createTodoSchema.parse(input);
    return createTodo(repository, data, LOCAL_USER_ID);
  });

  ipcMain.handle(IPC.todos.update, async (_event, id: unknown, input: unknown) => {
    if (typeof id !== "string") throw new Error("todo id must be a string");
    const data = updateTodoSchema.parse(input);
    return updateTodo(repository, id, LOCAL_USER_ID, data);
  });

  ipcMain.handle(IPC.todos.remove, async (_event, id: unknown) => {
    if (typeof id !== "string") throw new Error("todo id must be a string");
    return deleteTodo(repository, id, LOCAL_USER_ID);
  });
}
