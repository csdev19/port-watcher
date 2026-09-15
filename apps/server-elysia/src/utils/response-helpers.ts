import type {
  ApiResponse,
  PaginationMeta,
  PaginationQuery,
  PaginationResult,
} from "@monorepo-template/domain/types";

/**
 * Calculate pagination values from query params
 */
export function getPaginationParams(query: PaginationQuery): PaginationResult {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 10));
  const offset = (page - 1) * limit;

  return { page, limit, offset };
}

/**
 * Create pagination metadata
 */
export function createPaginationMeta(pagination: PaginationResult, total: number): PaginationMeta {
  return {
    page: pagination.page,
    limit: pagination.limit,
    total,
    totalPages: Math.ceil(total / pagination.limit),
  };
}

/**
 * Success response body
 * Use with Elysia's status() function: return status(200, successBody(data))
 */
export function successBody<T>(data: T): ApiResponse<T> {
  return {
    data,
    error: null,
  };
}

/**
 * Created response body (201)
 * Use: return status(201, createdBody(data))
 */
export function createdBody<T>(data: T): ApiResponse<T> {
  return successBody(data);
}

/**
 * Success with pagination body
 * Use: return status(200, successWithPaginationBody(data, pagination, total))
 */
export function successWithPaginationBody<T>(
  data: T[],
  pagination: PaginationResult,
  total: number,
): ApiResponse<T[]> {
  return {
    data,
    error: null,
    meta: {
      pagination: createPaginationMeta(pagination, total),
    },
  };
}

/**
 * Error response body
 * Use with set.status in error handler: set.status = 400; return errorBody(message)
 */
export function errorBody(message: string): ApiResponse<never> {
  return {
    data: null,
    error: { message },
  };
}
