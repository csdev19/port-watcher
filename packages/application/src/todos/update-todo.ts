import type { ITodoRepository } from "@port-watcher/domain/repositories";
import type { UpdateTodo, TodoBase } from "@port-watcher/domain/schemas";

export async function updateTodo(
  repository: ITodoRepository,
  id: string,
  userId: string,
  data: UpdateTodo,
): Promise<TodoBase | null> {
  return repository.update(id, userId, data);
}
