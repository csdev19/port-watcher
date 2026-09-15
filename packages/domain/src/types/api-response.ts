import type { PaginationMeta } from "../schemas/pagination";

/**
 * Standard API response structure
 * All API responses follow this format for consistency
 */
export interface ApiResponse<T> {
  data: T | null;
  error: { message: string } | null;
  meta?: {
    pagination?: PaginationMeta;
  };
}

/**
 * Generic paginated result for use cases
 * Reuses PaginationMeta as the single source of truth for pagination shape
 */
export interface PaginatedResult<T> {
  data: T[];
  meta: PaginationMeta;
}

/**
 * Calculated pagination values (internal helper for offset computation)
 */
export interface PaginationResult {
  page: number;
  limit: number;
  offset: number;
}
