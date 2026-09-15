import type { ITodoRepository } from "@monorepo-template/domain/repositories";
import type { TodoBase } from "@monorepo-template/domain/schemas";
import type { Result, PaginationQuery, PaginatedResult } from "@monorepo-template/domain/types";

export async function listTodos(params: {
  repo: ITodoRepository;
  userId: string;
  pagination: PaginationQuery;
}): Promise<Result<PaginatedResult<TodoBase>>> {
  const { repo, userId, pagination } = params;
  const page = pagination.page ?? 1;
  const limit = pagination.limit ?? 5;
  const offset = (page - 1) * limit;

  try {
    const result = await repo.findAllByUserIdPaginated(userId, limit, offset);
    return {
      data: {
        data: result.data,
        meta: {
          page,
          limit,
          total: result.total,
          totalPages: Math.ceil(result.total / limit),
        },
      },
      error: null,
    };
  } catch (error) {
    return { data: null, error: error as Error };
  }
}
