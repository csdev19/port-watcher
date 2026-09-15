/**
 * Helper to extract error message from Eden Treaty error response
 * Handles various error formats returned by the API
 */
export function getErrorMessage(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object" && "message" in error) {
    return String(error.message);
  }
  if (error && typeof error === "object" && "value" in error) {
    const value = (error as { value: unknown }).value;
    if (typeof value === "string") {
      return value;
    }
    if (value && typeof value === "object" && "message" in value) {
      return String(value.message);
    }
  }
  return "An error occurred";
}
