import app from "../index";

const BASE = "http://localhost";

/** Fire a request straight into the Hono app via `app.fetch` — no server, no network. */
export function req(path: string, init?: RequestInit): Promise<Response> {
  return app.fetch(new Request(`${BASE}${path}`, init));
}

let counter = 0;

/** A unique email per call, so parallel/repeated runs never collide on the branch. */
export function uniqueEmail(): string {
  counter += 1;
  return `test-${globalThis.Date.now()}-${counter}@example.com`;
}

export function uniqueName(): string {
  counter += 1;
  return `Test User ${globalThis.Date.now()}-${counter}`;
}

/**
 * Sign up a fresh user and return the session cookie (the `name=value` pair,
 * without attributes) ready to put on a `cookie` request header.
 */
export async function signUpAndGetCookie(): Promise<string> {
  const res = await req("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: uniqueEmail(), password: "password12345", name: uniqueName() }),
  });
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) {
    throw new Error(`sign-up did not set a session cookie (status ${res.status})`);
  }
  return setCookie.split(";")[0];
}

/** Headers carrying the session cookie plus a JSON content type. */
export function authed(cookie: string, extra?: Record<string, string>): Record<string, string> {
  return { "Content-Type": "application/json", cookie, ...extra };
}
