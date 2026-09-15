import type { Result } from "@monorepo-template/domain/types";
import { isFailure } from "@monorepo-template/domain/types";
import { InternalServerError } from "elysia";
import { NotFoundError } from "./errors";

/**
 * Error Handler Utilities
 *
 * Provides consistent error handling patterns for database operations
 * and other async operations that use the Result type pattern.
 */

/**
 * Handles a database query Result, throwing appropriate errors
 *
 * This function is designed to handle Results from database operations.
 * It converts database errors into domain-specific errors that can be
 * handled by the Elysia error handler.
 *
 * @template T - The type of data expected from the database query
 *
 * @param result - The Result from a database operation
 * @param notFoundMessage - Optional custom message for not found errors
 * @returns The data if successful
 * @throws {NotFoundError} If the result is a failure or data is null/undefined
 * @throws {InternalServerError} If there's an unexpected database error
 *
 * @example
 * ```typescript
 * const result = await tryCatch(
 *   db.select().from(users).where(eq(users.id, userId)).limit(1)
 * );
 *
 * const user = handleDatabaseResult(result, "User not found");
 * // user is guaranteed to exist here
 * ```
 */
export function handleDatabaseResult<T>(
  result: Result<T[], Error>,
  notFoundMessage: string = "Resource not found",
): T {
  if (isFailure(result)) {
    throw new InternalServerError(`Database error: ${result.error.message}`);
  }

  const data = result.data;
  if (!data || data.length === 0) {
    throw new NotFoundError(notFoundMessage);
  }

  const item = data[0];
  if (item === undefined) {
    throw new NotFoundError(notFoundMessage);
  }

  return item;
}

/**
 * Handles a database query Result that expects a single item
 *
 * Similar to `handleDatabaseResult` but specifically for queries that
 * should return exactly one item.
 *
 * @template T - The type of data expected
 *
 * @param result - The Result from a database operation
 * @param notFoundMessage - Optional custom message for not found errors
 * @returns The single item if found
 * @throws {NotFoundError} If no item is found
 * @throws {InternalServerError} If there's a database error
 *
 * @example
 * ```typescript
 * const result = await tryCatch(
 *   db.select().from(users).where(eq(users.id, userId)).limit(1)
 * );
 *
 * const user = handleSingleDatabaseResult(result, "User not found");
 * ```
 */
export function handleSingleDatabaseResult<T>(
  result: Result<T[], Error>,
  notFoundMessage: string = "Resource not found",
): T {
  return handleDatabaseResult(result, notFoundMessage);
}

/**
 * Handles a database query Result that expects multiple items (list)
 *
 * For list queries, we don't throw an error if the list is empty -
 * an empty array is a valid result. We only throw on actual errors.
 *
 * @template T - The type of items in the list
 *
 * @param result - The Result from a database operation
 * @returns The array of items (may be empty)
 * @throws {InternalServerError} If there's a database error
 *
 * @example
 * ```typescript
 * const result = await tryCatch(
 *   db.select().from(users).where(eq(users.status, "active"))
 * );
 *
 * const users = handleListDatabaseResult(result);
 * // users is an array (may be empty)
 * ```
 */
export function handleListDatabaseResult<T>(result: Result<T[], Error>): T[] {
  if (isFailure(result)) {
    throw new InternalServerError(`Database error: ${result.error.message}`);
  }

  return result.data || [];
}

/**
 * Handles a database mutation Result (insert, update, delete)
 *
 * For mutations, we check if the operation succeeded and if any rows
 * were affected. Throws appropriate errors if the operation failed.
 *
 * @template T - The type of data returned from the mutation
 *
 * @param result - The Result from a database mutation
 * @param notFoundMessage - Optional message if no rows were affected
 * @returns The mutation result data
 * @throws {NotFoundError} If no rows were affected (for update/delete)
 * @throws {InternalServerError} If there's a database error
 *
 * @example
 * ```typescript
 * const result = await tryCatch(
 *   db.update(users).set({ name: "John" }).where(eq(users.id, userId)).returning()
 * );
 *
 * const updated = handleMutationResult(result, "User not found");
 * ```
 */
export function handleMutationResult<T>(
  result: Result<T[], Error>,
  notFoundMessage: string = "Resource not found",
): T {
  if (isFailure(result)) {
    throw new InternalServerError(`Database error: ${result.error.message}`);
  }

  const data = result.data;
  if (!data || data.length === 0) {
    throw new NotFoundError(notFoundMessage);
  }

  const item = data[0];
  if (item === undefined) {
    throw new NotFoundError(notFoundMessage);
  }

  return item;
}

/**
 * Handles a generic operation Result with custom error mapping
 *
 * This is a flexible handler that allows you to provide custom error
 * mapping logic. Useful for operations that aren't database queries.
 *
 * @template T - The type of data on success
 * @template E - The type of error on failure
 *
 * @param result - The Result to handle
 * @param errorMapper - Function to map errors to domain errors
 * @returns The data if successful
 * @throws The error returned by errorMapper
 *
 * @example
 * ```typescript
 * const result = await tryCatch(validateUserInput(input));
 *
 * const validInput = handleResult(result, (error) => {
 *   if (error instanceof ValidationError) {
 *     return new BadRequestError(error.message);
 *   }
 *   return new InternalServerError("Validation failed");
 * });
 * ```
 */
export function handleResult<T, E = Error>(
  result: Result<T, E>,
  errorMapper: (error: E) => Error = (error) => {
    if (error instanceof Error) {
      return new InternalServerError(error.message);
    }
    return new InternalServerError("Operation failed");
  },
): T {
  if (isFailure(result)) {
    throw errorMapper(result.error);
  }

  return result.data;
}
