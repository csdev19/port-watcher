import { createServerFn } from "@tanstack/react-start";
import type { ApiResponse } from "@monorepo-template/domain/types";
import type { TodoBase, PaginationQuery } from "@monorepo-template/domain/schemas";
import { paginationQuerySchema } from "@monorepo-template/domain/schemas";
import { createDatabaseClient } from "@monorepo-template/infra-db/client";
import { TodoRepository } from "@monorepo-template/infra-db/repositories";
import { listTodos as listTodosUseCase } from "@monorepo-template/application";
import { getAuthSession } from "@/lib/auth/get-auth-session";
import { env } from "@/env/server";

export const listTodos = createServerFn({ method: "GET" })
  .inputValidator((input: PaginationQuery) => paginationQuerySchema.parse(input))
  .handler(async (ctx): Promise<ApiResponse<TodoBase[]>> => {
    const session = await getAuthSession();

    if (!session) {
      return { data: null, error: { message: "Unauthorized" } };
    }

    const db = createDatabaseClient(env.DATABASE_URL);
    const repo = new TodoRepository(db);
    const result = await listTodosUseCase({
      repo,
      userId: session.user.id,
      pagination: ctx.data,
    });

    if (result.error) {
      const message = result.error instanceof Error ? result.error.message : "Failed to list todos";
      return { data: null, error: { message } };
    }

    return {
      data: result.data.data,
      error: null,
      meta: { pagination: result.data.meta },
    };
  });
