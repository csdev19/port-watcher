import type { ITodoRepository } from "@port-watcher/domain/repositories";
import type { TodoBase } from "@port-watcher/domain/schemas";

export async function getTodo(
  repository: ITodoRepository,
  id: string,
  userId: string,
): Promise<TodoBase | null> {
  return repository.findById(id, userId);
}
