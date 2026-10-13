# Architecture Context

**chapay — port watcher** — the Tauri 2 menu-bar desktop app (Rust core + React renderer, the product),
a TanStack Start app that serves its landing page, and a documentation site. The shared packages are a
DDD + Hexagonal template (a Todo example) that the web app was cloned from. The web app's auth and
database are disabled (ADR 0005) and the desktop app imports none of the packages. They are kept
deliberately (#27), so describe them as dormant, not as removed.

> The general architecture knowledge (DDD + hexagonal, bounded contexts, repository pattern, Result
> types, dependency injection, schema-driven validation) lives in the
> [general-knowledge hub](https://github.com/csdev19/general-knowledge) — start at
> [architecture/](https://github.com/csdev19/general-knowledge/blob/main/architecture/README.md).
> This file only maps what is specific to _this project_.

## Shared packages (layer-first)

- `domain/` — Pure: Zod schemas, types, constants, repository interfaces (leaf, no deps)
- `application/` — Use cases (depend only on domain interfaces)
- `infra-db/` — Drizzle schemas, repositories, mappers, Neon serverless client (dormant: the DB is disabled)
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

- `apps/desktop` — chapay, Tauri 2: React/Vite renderer + Rust core in `src-tauri/` (crate
  `port-watcher`). The real domain logic (ports, kill guards, categories) lives here, not in the packages
- `apps/fullstack-fn-only` — TanStack Start, one Cloudflare Worker; serves only the landing today
  (server functions, auth and the DB are present but disabled)
- `apps/documentation` — Astro Starlight

See the [monorepo structure](https://github.com/csdev19/general-knowledge/blob/main/monorepos/monorepo-structure.md)
doc in the hub for the workspace / Turbo / catalog layout.
