/**
 * Utility type to extract object property values
 * Useful for creating type-safe constants
 */
export type ObjectProperties<T> = T[keyof T];

// Export Result types
export type { Success, Failure, Result } from "./result";

export { tryCatch, isSuccess, isFailure, unwrap } from "./result";

// Export API Response types
export type { ApiResponse, PaginatedResult, PaginationResult } from "./api-response";

// Re-export schema-derived types for convenience
// (source of truth lives in domain/schemas/pagination.ts)
export type { PaginationQuery, PaginationMeta } from "../schemas/pagination";
