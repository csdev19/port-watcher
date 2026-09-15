import { z } from "zod";
import { oc } from "@orpc/contract";
import {
  todoBaseSchema,
  createTodoSchema,
  updateTodoSchema,
  paginationQuerySchema,
  paginationMetaSchema,
} from "@monorepo-template/domain/schemas";

const errorSchema = z.object({ message: z.string() });

const apiResponseSchema = <T extends z.ZodType>(dataSchema: T) =>
  z.object({
    data: dataSchema.nullable(),
    error: errorSchema.nullable(),
  });

const paginatedApiResponseSchema = <T extends z.ZodType>(dataSchema: T) =>
  z.object({
    data: dataSchema.nullable(),
    error: errorSchema.nullable(),
    meta: z
      .object({
        pagination: paginationMetaSchema,
      })
      .optional(),
  });

export const todoContract = {
  list: oc
    .route({ method: "GET", path: "/todos" })
    .input(paginationQuerySchema)
    .output(paginatedApiResponseSchema(z.array(todoBaseSchema))),

  get: oc
    .route({ method: "GET", path: "/todos/{id}" })
    .input(z.object({ id: z.string() }))
    .output(apiResponseSchema(todoBaseSchema)),

  create: oc
    .route({ method: "POST", path: "/todos", successStatus: 201 })
    .input(createTodoSchema)
    .output(apiResponseSchema(todoBaseSchema)),

  update: oc
    .route({ method: "PUT", path: "/todos/{id}" })
    .input(updateTodoSchema.extend({ id: z.string() }))
    .output(apiResponseSchema(todoBaseSchema)),

  delete: oc
    .route({ method: "DELETE", path: "/todos/{id}" })
    .input(z.object({ id: z.string() }))
    .output(apiResponseSchema(z.object({ success: z.boolean() }))),
};
