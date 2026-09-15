import { Hono } from "hono";
import { cors } from "hono/cors";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { auth } from "./lib/auth";
import { appRouter } from "./router";

const app = new Hono();

// CORS only needed for mobile apps — web requests come through
// the web Worker proxy via Service Bindings (same-origin, no CORS needed)
app.use(
  "*",
  cors({
    origin: ["exp://", "mobile://", "exp://*"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowHeaders: ["Content-Type", "Authorization", "Cookie"],
    credentials: true,
    maxAge: 86400,
  }),
);

// Better Auth handler
app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

// Health endpoint
app.get("/api/v1/health", (c) =>
  c.json({ status: "healthy", timestamp: new Date().toISOString() }),
);

// oRPC OpenAPIHandler — REST-style URLs at /api/v1/*
const openAPIHandler = new OpenAPIHandler(appRouter);

app.all("/api/v1/*", async (c) => {
  const { matched, response } = await openAPIHandler.handle(c.req.raw, {
    prefix: "/api/v1",
    context: { headers: c.req.raw.headers },
  });

  if (matched) return response;
  return c.notFound();
});

export default app;
