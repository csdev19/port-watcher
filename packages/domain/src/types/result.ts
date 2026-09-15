/**
 * Result type pattern for better error handling
 * Inspired by Rust's Result<T, E> type
 *
 * This is a domain-level concept representing the outcome of operations
 * without throwing exceptions, making error handling explicit and type-safe.
 */

// Types for the result object with discriminated union
export type Success<T> = {
  data: T;
  error: null;
};

export type Failure<E> = {
  data: null;
  error: E;
};

export type Result<T, E = Error> = Success<T> | Failure<E>;

/**
 * Wraps a promise in a Result type for better error handling
 *
 * @example
 * const result = await tryCatch(db.select().from(users));
 * if (result.error) {
 *   // Handle error
 *   return;
 * }
 * // TypeScript knows result.data exists here
 * console.log(result.data);
 */
export async function tryCatch<T, E = Error>(promise: Promise<T>): Promise<Result<T, E>> {
  try {
    const data = await promise;
    return { data, error: null };
  } catch (error) {
    return { data: null, error: error as E };
  }
}

/**
 * Helper to check if result is success
 */
export function isSuccess<T, E>(result: Result<T, E>): result is Success<T> {
  return result.error === null;
}

/**
 * Helper to check if result is failure
 */
export function isFailure<T, E>(result: Result<T, E>): result is Failure<E> {
  return result.error !== null;
}

/**
 * Unwrap result or throw error
 * Use with caution - only when you're certain it's a success
 */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.error) {
    throw result.error;
  }
  return result.data as T;
}
