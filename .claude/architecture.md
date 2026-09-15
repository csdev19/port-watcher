# Architecture Context

**chapay — port watcher** — a fullstack serverFn project (DDD + Hexagonal Architecture): one TanStack Start
app whose server functions are the only adapters over the shared packages, plus a documentation site
and the Tauri 2 desktop app.

> The general architecture knowledge (DDD + hexagonal, bounded contexts, repository pattern, Result
> types, dependency injection, schema-driven validation) lives in the
> [general-knowledge hub](https://github.com/csdev19/general-knowledge) — start at
> [architecture/](https://github.com/csdev19/general-knowledge/blob/main/architecture/README.md).
> This file only maps what is specific to _this project_.

## Shared packages (layer-first)

- `domain/` — Pure: Zod schemas, types, constants, repository interfaces (leaf, no deps)
- `application/` — Use cases (depend only on domain interfaces)
- `infra-db/` — Drizzle schemas, repositories, mappers, Neon client
- `infra-auth/` — Better Auth base config
- `infra-env/` — Zod env schemas (one per app)
- `web-ui/` — Shared React UI (shadcn/ui, Tailwind) — exports built dist/
- `tokens/` — Design tokens; one typed TS source generating CSS custom properties
- `i18n/` — use-intl catalogs (en/es), React provider and a non-React `core` export
- `config/` — Shared tsconfig

`tokens` and `i18n` have no consumer in the web app today; they are kept for the Tauri renderer.

**Dependency rule (strict):** `domain <- application <- infra-*`; only apps wire them together.
`domain` is a leaf, so importing it can never transitively pull in server code — which is what will
let the Tauri app reuse it without dragging in Node or Drizzle.

## Apps

- `apps/fullstack-fn-only` — TanStack Start (client + server functions), one Cloudflare Worker
- `apps/documentation` — Astro Starlight
- `apps/desktop` — Tauri 2: React/Vite renderer + Rust core in `src-tauri/` (crate `port-watcher`)

See the [monorepo structure](https://github.com/csdev19/general-knowledge/blob/main/monorepos/monorepo-structure.md)
doc in the hub for the workspace / Turbo / catalog layout.
