# Development Rules

**chapay — port watcher** — a monorepo (DDD + Hexagonal Architecture, TypeScript, Bun, Turborepo)
holding one TanStack Start web app, a documentation site, and (in progress) the Tauri 2 menu-bar
desktop app that lists listening TCP ports and kills the process behind one.

The product is **chapay** (lowercase, Quechua for "to watch, to guard"); "chapay — port watcher" is
the full title. The repository, the workspace scope (`@port-watcher/*`) and the Rust crate still
carry the old `port-watcher` name — renaming those is a separate, deliberate change.

## Knowledge lives in the hub, not here

Reusable, product-agnostic knowledge is **not** duplicated in this file — it lives in the
[general-knowledge hub](https://github.com/csdev19/general-knowledge). Key topics (don't re-document
them here):

- **Feature workflow** — [MVP first, then refactor](https://github.com/csdev19/general-knowledge/blob/main/conventions/mvp-first-then-refactor.md).
- **Architecture & the dependency rule** — [architecture/](https://github.com/csdev19/general-knowledge/blob/main/architecture/README.md)
  (`domain <- application <- infra-*`; `infra-*` naming convention; import rules).
- **web-ui `dist/` build strategy** — [web/web-ui-package.md](https://github.com/csdev19/general-knowledge/blob/main/web/web-ui-package.md).
- **Cloudflare Wrangler & env config** — [monorepos/wrangler-env-config.md](https://github.com/csdev19/general-knowledge/blob/main/monorepos/wrangler-env-config.md).

## Topology

- `apps/fullstack-fn-only` — TanStack Start. The client and the server live in one Cloudflare
  Worker: server functions (`src/server-functions/`) are the adapters that wire `infra-db`
  repositories into `application` use cases, and Better Auth is mounted at
  `src/routes/api/auth/$.ts`. No separate API worker, no proxy, no CORS boundary — cookies are
  same-origin.
- `apps/documentation` — Astro Starlight.
- `apps/desktop` — Tauri 2 app (React + TS + Vite renderer, Rust core in `src-tauri/`). The Rust
  side reads listening ports and kills processes; the renderer reaches it through `invoke()`.
  Crate name is `port-watcher`, lib `port_watcher_lib`, bundle id `dev.csdev19.portwatcher`.

## Package Import Rules

- `domain` never imports from `application` or `infra-*`
- `application` never imports from `infra-*` (uses domain interfaces)
- `infra-*` never imports from `application`
- Only apps wire the layers together

## Project-specific rules

- **Skill Configuration:** Skills in `.claude/skills/` may have a **Configuration** table with paths
  (e.g. `DOCS_BASE`). If a skill's configured path no longer matches the actual project path, update
  the skill's Configuration table directly so future sessions don't re-discover it.
- **Env / Wrangler (sharp gotcha):** ALWAYS use `.env` (and `.dev.vars` for local Worker secrets).
  NEVER add a `vars` / `[vars]` / `[env.*]` block to `wrangler.jsonc` — Wrangler auto-loads `.env`,
  so a `vars` block drifts from the single source of truth. Wrangler is pinned in the root catalog;
  keep `compatibility_date` current and identical across all `wrangler.jsonc`, and run
  `wrangler types` after editing one. Full rules in the hub link above.
- **`fullstackServerEnvSchema` is the env contract:** `packages/infra-env/src/fullstack-server.ts`
  parses `process.env` at boot, so a variable that is not in that schema does not exist for the app.
  Add it there and to `apps/fullstack-fn-only/.env.example` together.
- **web-ui needs `dist/`:** `@port-watcher/web-ui` exports point to built files, and `dist/` is
  NOT committed — a fresh clone has none. Run `bun run build --filter='@port-watcher/*'` before
  `bun run check-types`, or the apps that import web-ui fail with "Cannot find module". CI already
  builds packages first. Rebuild after editing web-ui components.
- **`tokens` and `i18n` are kept for the Tauri app:** nothing in the web app imports them today.
  They survive because the desktop renderer will consume `@port-watcher/tokens/css` for its
  stylesheet and `@port-watcher/i18n` for UI copy. Don't prune them as dead weight.
- **`dotenvx` is not installed:** the root `db:*` scripts call `dotenvx run -f
apps/fullstack-fn-only/.env`, which needs a global `dotenvx` (or a root devDependency). See the
  open item in `apps/documentation/src/content/docs/environment-variables.mdx`.

## Desktop app scripts (sharp gotcha)

`desktop`'s `dev`/`build` scripts are the **frontend only** — Tauri itself calls them through
`beforeDevCommand`/`beforeBuildCommand` in `src-tauri/tauri.conf.json`. The real app runs under
`tauri:dev` / `tauri:build`, which is why the root `dev` script filters the package out
(`turbo run dev --filter=!desktop`): a bare `turbo run dev` would otherwise start a headless Vite on
port 1420 with no window attached. Use `bun run dev:desktop`. If you rename the frontend scripts,
change `tauri.conf.json` in the same commit.

## Common Commands

- `bun run dev:desktop` — run the Tauri app · `bun run build:desktop` — bundle it
- `bun run dev:fullstack-fn` — start the web app alone
- `bun run db:push` — push the Drizzle schema to the DB (run from the monorepo root)
- `bun run db:studio` — open Drizzle Studio
