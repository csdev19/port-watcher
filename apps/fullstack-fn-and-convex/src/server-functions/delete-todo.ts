import { createServerFn } from "@tanstack/react-start";
import type { ApiResponse } from "@monorepo-template/domain/types";
import { createDatabaseClient } from "@monorepo-template/infra-db/client";
import { TodoRepository } from "@monorepo-template/infra-db/repositories";
import { getAuthSession } from "@/lib/auth/get-auth-session";
import { env } from "@/env/server";
import z from "zod";

const deleteTodoInputSchema = z.object({
  id: z.string(),
});

export const deleteTodo = createServerFn({ method: "POST" })
  .inputValidator((input: { id: string }) => deleteTodoInputSchema.parse(input))
  .handler(async (ctx): Promise<ApiResponse<{ success: boolean }>> => {
    const session = await getAuthSession();

    if (!session) {
      return { data: null, error: { message: "Unauthorized" } };
    }

    const db = createDatabaseClient(env.DATABASE_URL);
    const repo = new TodoRepository(db);
    const deleted = await repo.delete(ctx.data.id, session.user.id);

    if (!deleted) {
      return { data: null, error: { message: "Todo not found" } };
    }

    return { data: { success: true }, error: null };
  });
