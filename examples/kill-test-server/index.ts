import { Hono } from "hono";

const app = new Hono();

app.get("/", (c) => c.json({ ok: true, message: "chapay test server", pid: process.pid }));

const port = Number(process.env.PORT ?? 3999);

console.log(`chapay test server listening on http://localhost:${port} (pid ${process.pid})`);

export default { port, fetch: app.fetch };
