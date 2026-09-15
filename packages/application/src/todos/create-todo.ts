import type { ITodoRepository } from "@monorepo-template/domain/repositories";
import type { CreateTodo, TodoBase } from "@monorepo-template/domain/schemas";

export async function createTodo(
  repository: ITodoRepository,
  data: CreateTodo,
  userId: string,
): Promise<TodoBase> {
  return repository.create({ ...data, userId });
}
