import { Elysia, InternalServerError } from "elysia";
import { UnauthorizedError, NotFoundError, BadRequestError, ConflictError } from "./errors";
import { errorBody } from "./response-helpers";

/**
 * Centralized error handler plugin for Elysia routes
 *
 * This plugin provides consistent error handling across all routes:
 * - Registers common error classes
 * - Maps error codes to HTTP status codes
 * - Returns standardized error responses
 *
 * @example
 * ```typescript
 * export const routes = new Elysia({ prefix: "/api/resource" })
 *   .use(errorHandlerPlugin)
 *   .get("/", handler);
 * ```
 *
 * Routes can still add route-specific errors after using this plugin:
 * ```typescript
 * export const routes = new Elysia({ prefix: "/api/resource" })
 *   .use(errorHandlerPlugin)
 *   .error({ CustomError })  // Route-specific error
 *   .get("/", handler);
 * ```
 */
export const errorHandlerPlugin = new Elysia()
  .error({
    UnauthorizedError,
    NotFoundError,
    BadRequestError,
    ConflictError,
    InternalServerError,
  })
  .onError(({ code, error, set }) => {
    // Handle custom errors with proper status codes
    if (code === "UnauthorizedError") {
      set.status = 401;
      return errorBody(error.message);
    }

    if (code === "NotFoundError") {
      set.status = 404;
      return errorBody(error.message);
    }

    if (code === "BadRequestError" || code === "ConflictError") {
      set.status = error.status;
      return errorBody(error.message);
    }

    if (code === "InternalServerError") {
      set.status = 500;
      return errorBody(error.message);
    }

    // Handle validation errors (from Zod or Elysia t)
    if (code === "VALIDATION") {
      set.status = 400;
      return errorBody(error.message);
    }

    // Handle unknown errors
    set.status = 500;
    return errorBody("Internal server error");
  });
