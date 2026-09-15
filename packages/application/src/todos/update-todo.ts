import type { ITodoRepository } from "@monorepo-template/domain/repositories";
import type { UpdateTodo, TodoBase } from "@monorepo-template/domain/schemas";

export async function updateTodo(
  repository: ITodoRepository,
  id: string,
  userId: string,
  data: UpdateTodo,
): Promise<TodoBase | null> {
  return repository.update(id, userId, data);
}
