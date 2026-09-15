import { z } from "zod";

/**
 * Pagination query parameters schema
 * Used for list endpoints that support pagination (input validation)
 */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1, "Page must be at least 1").default(1).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1, "Limit must be at least 1")
    .max(100, "Limit cannot exceed 100")
    .default(5)
    .optional(),
});

/**
 * Pagination metadata schema
 * Used in API responses to describe the current page of results
 */
export const paginationMetaSchema = z.object({
  page: z.number().int(),
  limit: z.number().int(),
  total: z.number().int(),
  totalPages: z.number().int(),
});

// Types inferred from schemas — single source of truth
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
export type PaginationMeta = z.infer<typeof paginationMetaSchema>;
