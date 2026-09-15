import { beforeAll, describe, expect, it } from "vitest";
import { authed, req, signUpAndGetCookie } from "./helpers";

// In-process integration tests: they call the real Hono app against a real Neon
// branch (DATABASE_URL from .env.test). No mocks. See
// general-knowledge/monorepos/testing/integration.md.
describe("todo API (integration)", () => {
  let cookie: string;

  beforeAll(async () => {
    cookie = await signUpAndGetCookie();
  });

  it("serves health without auth", async () => {
    const res = await req("/api/v1/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "healthy" });
  });

  it("rejects an unauthenticated create", async () => {
    const res = await req("/api/v1/todos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "nope" }),
    });
    expect(res.status).toBe(401);
  });

  it("creates, lists, and deletes a todo for the signed-in user", async () => {
    const create = await req("/api/v1/todos", {
      method: "POST",
      headers: authed(cookie),
      body: JSON.stringify({ title: "Buy milk" }),
    });
    expect(create.status).toBe(201);
    const created = (await create.json()) as { data: { id: string; title: string } };
    expect(created.data.title).toBe("Buy milk");

    const list = await req("/api/v1/todos", { headers: authed(cookie) });
    expect(list.status).toBe(200);
    const listed = (await list.json()) as { data: Array<{ id: string }> };
    expect(listed.data.some((t) => t.id === created.data.id)).toBe(true);

    const del = await req(`/api/v1/todos/${created.data.id}`, {
      method: "DELETE",
      headers: authed(cookie),
    });
    expect(del.status).toBe(200);
  });
});
