import type { ITodoRepository } from "@port-watcher/domain/repositories";
import type { CreateTodo, TodoBase } from "@port-watcher/domain/schemas";

export async function createTodo(
  repository: ITodoRepository,
  data: CreateTodo,
  userId: string,
): Promise<TodoBase> {
  return repository.create({ ...data, userId });
}
