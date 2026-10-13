# Development Rules

**chapay — port watcher** — a monorepo (DDD + Hexagonal Architecture, TypeScript, Bun, Turborepo)
holding the Tauri 2 menu-bar desktop app (shipped, 0.1.0) that lists listening TCP ports and kills
the process behind one, the TanStack Start landing page, and a documentation site.

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

- `apps/fullstack-fn-only` — TanStack Start. Today it only serves the chapay landing
  (`chapay.cs19.dev`) as one Cloudflare Worker. Auth (Better Auth), the todos demo, the server
  functions (`src/server-functions/`) and the database are **disabled**: the route files stay in the
  tree but are unregistered (`routeFileIgnorePattern` in `vite.config.ts`) and excluded from
  `tsconfig.json`. When re-enabled, server functions are the adapters that wire `infra-db`
  repositories into `application` use cases, and Better Auth is mounted at
  `src/routes/api/auth/$.ts`. See ADR 0005.
- `apps/documentation` — Astro Starlight.
- `apps/desktop` — chapay, the Tauri 2 app (React + TS + Vite renderer, Rust core in `src-tauri/`).
  The Rust side reads listening ports and kills processes; the renderer reaches it through
  `invoke()`. It imports no `@port-watcher/*` runtime package (only `config` for tsconfig).
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
- **`fullstackServerEnvSchema` is the env contract (dormant):**
  `packages/infra-env/src/fullstack-server.ts` is parsed by `apps/fullstack-fn-only/src/env/server.ts`,
  which is excluded from compilation while auth and the DB are off, so the running landing reads no
  server env. When the server code returns, a variable not in that schema does not exist for the app:
  add it there and to `apps/fullstack-fn-only/.env.example` together.
- **Dormant template packages:** `domain`, `application`, `infra-db`, `infra-auth` and `infra-env`
  hold the Todo/auth template, not chapay's logic (that is Rust plus `apps/desktop/src/lib`). The
  owner kept them deliberately (#27); do not delete them or describe them as removed.
- **web-ui needs `dist/`:** `@port-watcher/web-ui` exports point to built files, and `dist/` is
  NOT committed — a fresh clone has none. Run `bun run build --filter='@port-watcher/*'` before
  `bun run check-types`, or the apps that import web-ui fail with "Cannot find module". CI already
  builds packages first. Rebuild after editing web-ui components.
- **`tokens` and `i18n` are kept for the Tauri app:** nothing in the web app imports them today.
  They survive because the desktop renderer will consume `@port-watcher/tokens/css` for its
  stylesheet and `@port-watcher/i18n` for UI copy. Don't prune them as dead weight.
- **`dotenvx` is not installed:** the root `db:*` scripts call `dotenvx run -f
apps/fullstack-fn-only/.env`, which needs a global `dotenvx` (or a root devDependency), and the DB
  they target is disabled. See the open item in
  `apps/documentation/src/content/docs/environment-variables.mdx`.

## Desktop app scripts (sharp gotcha)

`desktop`'s frontend-only scripts are `vite:dev`/`build` — Tauri itself calls them through
`beforeDevCommand`/`beforeBuildCommand` in `src-tauri/tauri.conf.json`. The real app runs under
`tauri:dev` / `tauri:build`. Turbo runs a task by exact script name across every package that
defines it, so `desktop` deliberately has **no** `dev` script (only `vite:dev`) — if it did, a bare
`turbo run dev` would launch a second, windowless Vite on port 1420 alongside the one Tauri starts
itself. This is what lets the root `dev` script run `turbo run dev tauri:dev` as a single Turbo
invocation: `dev` fires for web + docs (desktop has no `dev` task to match), `tauri:dev` fires for
desktop, both in parallel. If you rename `vite:dev`, change `tauri.conf.json`'s `beforeDevCommand`
in the same commit — and never reintroduce a script literally named `dev` on `desktop`.

## Common Commands

- `bun run dev` — run web, docs, and the Tauri desktop app together
- `bun run dev:desktop` — run only the Tauri app · `bun run build:desktop` — bundle it
- `bun run dev:fullstack-fn` — start the web app alone
- `bun run setup` — bootstrap a fresh macOS clone (Apple tools, Rust, deps, package builds)
- `bun run db:push` / `db:studio` — Drizzle, only useful once the DB is re-enabled (ADR 0005)

## Releases (sharp gotcha)

release-please owns versions: `desktop` (`desktop-v*` → `release-desktop.yml`, signed DMGs to R2
`chapay-bucket`) and `web` (`web-v*` → `release-web.yml`). Never bump `apps/desktop` or
`apps/fullstack-fn-only` `package.json` versions or push tags by hand — merge the release PR.
`tauri.conf.json` reads its version from `apps/desktop/package.json`. Flow and secrets:
`apps/documentation/src/content/docs/desktop/releasing.mdx`; decision: `docs/adr/0003-*`.

## Manual testing fixtures

- `examples/kill-test-server/` — a disposable Hono server (one endpoint) for manually exercising
  chapay's listener detection and kill flow. Standalone package, deliberately **outside** the
  `apps/*`/`packages/*` workspace glob so it never enters `build`/`test`/`check-types`. See its
  README for usage.
