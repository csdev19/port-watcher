import type { ITodoRepository } from "@port-watcher/domain/repositories";

export async function deleteTodo(
  repository: ITodoRepository,
  id: string,
  userId: string,
): Promise<boolean> {
  return repository.delete(id, userId);
}
