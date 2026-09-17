# kill-test-server

A disposable Hono server with one endpoint, for manually exercising
chapay's listener detection and kill flow. Standalone package — not part
of the `apps/*` / `packages/*` workspace glob, so it never enters the
monorepo's `build`/`test`/`check-types` pipeline.

## Run

```sh
cd examples/kill-test-server
bun install
bun run start          # listens on :3999
PORT=4001 bun run start # or a different port
```

Then open chapay, find the port in Listening, and kill it. Stop it
manually if you don't kill it from the app:

```sh
lsof -tiTCP:3999 | xargs kill
```
