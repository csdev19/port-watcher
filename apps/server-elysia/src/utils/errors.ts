// Custom error classes for better error handling in Elysia

export class UnauthorizedError extends Error {
  status = 401;
  constructor(message: string = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class NotFoundError extends Error {
  status = 404;
  constructor(resource: string = "Resource") {
    super(`${resource} not found`);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends Error {
  status = 409;
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

export class ForbiddenError extends Error {
  status = 403;
  constructor(message: string = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class BadRequestError extends Error {
  status = 400;
  constructor(message: string = "Bad request") {
    super(message);
    this.name = "BadRequestError";
  }
}

export class InternalServerError extends Error {
  status = 500;
  constructor(message: string = "Internal server error") {
    super(message);
    this.name = "InternalServerError";
  }
}
