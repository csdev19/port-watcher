import type { ITodoRepository } from "@monorepo-template/domain/repositories";
import type { TodoBase } from "@monorepo-template/domain/schemas";

export async function getTodo(
  repository: ITodoRepository,
  id: string,
  userId: string,
): Promise<TodoBase | null> {
  return repository.findById(id, userId);
}
