# Monorepo Template

A production-ready **multi-pattern** monorepo template with DDD + Hexagonal Architecture, authentication, Cloudflare deployment configs, and a Todo CRUD example. Built with TypeScript, Bun, and Turborepo.

It ships **six interchangeable architecture patterns** side by side — four web stacks, a backend-only service, and a local-first desktop app. You pick one with `bun run customize` (see [Choose your pattern](#choose-your-pattern)), which strips the repo down to just that pattern.

## Knowledge Documentation

Reusable, product-agnostic knowledge (architecture, stacks, error handling, monorepos,
packages, conventions) lives in a central hub instead of being copy-pasted into every
project: **[general-knowledge](https://github.com/csdev19/general-knowledge)**.

Start from the **stack recipe** that matches this project — each one is a linked reading
list into the flat knowledge docs plus the assembly notes for that stack:

| Stack                     | Recipe                                                                                                                 |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Hono + oRPC** (default) | [stacks/fullstack-hono-orpc](https://github.com/csdev19/general-knowledge/blob/main/stacks/fullstack-hono-orpc.md)     |
| **Elysia + Eden**         | [stacks/fullstack-elysia-eden](https://github.com/csdev19/general-knowledge/blob/main/stacks/fullstack-elysia-eden.md) |
| **Convex** (realtime)     | [stacks/fullstack-convex](https://github.com/csdev19/general-knowledge/blob/main/stacks/fullstack-convex.md)           |
| **Backend only**          | [stacks/service-only-hono](https://github.com/csdev19/general-knowledge/blob/main/stacks/service-only-hono.md)         |
| **Mobile (Expo)**         | [stacks/mobile-expo](https://github.com/csdev19/general-knowledge/blob/main/stacks/mobile-expo.md)                     |
| **Desktop (Electron)**    | [stacks/desktop-electron](https://github.com/csdev19/general-knowledge/blob/main/stacks/desktop-electron.md)           |

Deferred work and ideas for this project go in the **Backlog** section of the docs site
([`apps/documentation/src/content/docs/backlog/`](./apps/documentation/src/content/docs/backlog/index.mdx))
— see the [backlog pattern](https://github.com/csdev19/general-knowledge/blob/main/conventions/backlog-pattern.md).

## Choose your pattern

This is the **first thing to run on a fresh clone**. The template contains six patterns; `customize` keeps the one you choose and deletes the rest (apps, packages, scripts, catalog entries, CI, and env schemas), then optionally renames the `@monorepo-template` scope.

```bash
bun run customize
```

| Pattern                  | Apps kept                      | Data access       | Web dev port |
| ------------------------ | ------------------------------ | ----------------- | ------------ |
| **Client-Server Elysia** | `web-elysia` + `server-elysia` | Eden Treaty → API | 3003         |
| **Client-Server Hono**   | `web-hono` + `server-hono`     | oRPC → API        | 3001         |
| **Backend only**         | `server-hono`                  | oRPC → API        | — (no web)   |
| **Fullstack serverFn**   | `fullstack-fn-only`            | TanStack serverFn | 3002         |
| **Fullstack + Convex**   | `fullstack-fn-and-convex`      | serverFn + Convex | 3004         |
| **Desktop local-first**  | `desktop`                      | on-device SQLite  | — (Electron) |

In the **client-server** patterns the web app is a pure proxy client: it forwards all `/api/auth/*` and `/api/v1/*` requests to a separate backend Worker and never touches the database or runs Better Auth itself. In the **fullstack** patterns the TanStack Start app is the backend — its serverFns talk to the database directly.

**Backend only** is for a service consumed by products in _other repositories_ — a centralized auth, billing, or notification service. There is no web app, so there is no proxy: every consumer calls it cross-origin, and `customize` rewires CORS and Better Auth's `trustedOrigins` to the `CORS_ORIGIN` allowlist accordingly. It keeps `i18n` (a headless service still renders localized email and push copy) and drops `web-ui` and `tokens`. See the [service-only-hono recipe](https://github.com/csdev19/general-knowledge/blob/main/stacks/service-only-hono.md).

**Desktop local-first** is an Electron app with no server and no network calls: state lives in an on-device SQLite database opened by the main process. It is also the template's clearest demonstration of the dependency rule — its `SqliteTodoRepository` implements the very same `ITodoRepository` port that `infra-db` implements with Drizzle/Postgres, so the use cases in `application` run unchanged on both. See [`apps/desktop/README.md`](./apps/desktop/README.md).

The desktop app is **also available as an add-on to any other pattern** (`customize` asks, like it does for mobile and docs) — a web stack plus a desktop client sharing `domain`, `application`, `i18n` and `tokens`.

`customize` self-deletes when done. If you only need to rename the package scope, run `bun run rename <scope>` instead.

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) v1.3.4 or higher
- PostgreSQL database (e.g., [Neon](https://neon.tech))

### Installation

1. Clone and pick a pattern:

   ```bash
   git clone <repository-url>
   cd monorepo-template
   bun install
   bun run customize   # keep one pattern, delete the rest
   ```

2. Set up environment variables:

   **With dotenvx (recommended):** get the `.env.keys` file from your team lead and place it at the repo root. The encrypted `.env` files are already committed — dotenvx decrypts them at runtime.

   **Manual setup:** copy the `.env.example` of each kept app and fill it in. Which vars you need depends on the pattern:

   | Variable              | Where                   | Description                                   |
   | --------------------- | ----------------------- | --------------------------------------------- |
   | `DATABASE_URL`        | backend / fullstack app | Neon PostgreSQL connection string             |
   | `DATABASE_URL_DIRECT` | backend app             | Direct (non-pooled) connection for migrations |
   | `BETTER_AUTH_SECRET`  | backend / fullstack app | `openssl rand -base64 32`                     |
   | `CORS_ORIGIN`         | backend app             | Web app origin (mobile CORS)                  |
   | `VITE_SERVER_URL`     | web app (client-server) | Backend URL the web proxies to                |

   > The client-server **web** apps only need `VITE_SERVER_URL` — no DB URL or auth secret, since they proxy everything to the backend.

3. Push the database schema and start dev:

   ```bash
   bun run db:push
   bun run dev
   ```

## Project Structure

```
monorepo-template/
├── apps/
│   ├── web-elysia/               # Client-Server frontend (Eden Treaty)
│   ├── server-elysia/            # Elysia API (Cloudflare Workers)
│   ├── web-hono/                 # Client-Server frontend (oRPC)
│   ├── server-hono/              # Hono + oRPC API (Cloudflare Workers)
│   ├── fullstack-fn-only/        # TanStack Start fullstack (serverFn)
│   ├── fullstack-fn-and-convex/  # TanStack Start + Convex realtime
│   ├── desktop/                  # Local-first Electron app (electron-vite + SQLite)
│   ├── mobile/                   # Mobile app (Expo / React Native)
│   └── documentation/            # Documentation site (Astro Starlight)
│
├── packages/
│   ├── domain/            # Pure business logic: schemas, types, repository interfaces
│   ├── application/       # Use cases (depends only on domain interfaces)
│   ├── infra-db/          # Drizzle schemas, repositories, mappers
│   ├── infra-auth/        # Better Auth configuration
│   ├── infra-cloudflare/  # Worker-to-Worker proxy + Service Binding fetch (client-server)
│   ├── infra-env/         # Zod env schemas per app type
│   ├── web-ui/            # Shared React UI components (shadcn/ui)
│   ├── i18n/              # Message catalogs + React provider + non-React core
│   ├── tokens/            # Design tokens -> CSS custom properties (web + desktop)
│   └── config/            # Shared TypeScript configuration
```

Only the apps/packages for your chosen pattern remain after `customize`.

## Available Scripts

### Development

- `bun run dev` — Start the kept application(s) in development mode
- `bun run dev:web-elysia` / `dev:server-elysia` — Elysia pattern
- `bun run dev:web-hono` / `dev:server-hono` — Hono pattern
- `bun run dev:fullstack-fn` / `dev:fullstack-convex` — fullstack patterns
- `bun run dev:native` — Start the Expo mobile app
- `bun run dev:desktop` — Start the Electron desktop app

### Building

- `bun run build` — Build all applications for production

### Database

- `bun run db:push` — Push schema changes to the database
- `bun run db:studio` — Open Drizzle Studio (database GUI)
- `bun run db:generate` — Generate migration files
- `bun run db:migrate` — Run database migrations

### Code Quality

- `bun run check-types` — Check TypeScript types across all packages
- `bun run lint` — Lint all files with oxlint
- `bun run format` — Format all files with oxfmt
- `bun run check` — Run both lint and format

## Architecture

This template follows DDD + Hexagonal Architecture with a layer-first package structure. The dependency rule is strict: inner layers never depend on outer layers.

```
                ┌─────────────────┐
                │     domain      │  Pure. No dependencies.
                │  schemas, types │  Schemas, types, repository interfaces.
                │  repo interfaces│
                └────────┬────────┘
                         │
             ┌───────────┼───────────┐
             v                       v
      ┌──────────────┐       ┌──────────────┐
      │  application │       │   infra-db   │
      │  (use cases) │       │   infra-auth │
      │              │       │              │
      │  imports     │       │  implements  │
      │  from domain │       │  domain      │
      └──────┬───────┘       └──────┬───────┘
             │                      │
             └──────────┬───────────┘
                        v
                 ┌─────────────┐
                 │    apps     │  Wire everything together.
                 │             │  Dependency injection happens here.
                 └─────────────┘
```

The Todo CRUD example demonstrates this architecture end-to-end:

1. **Domain** — Zod schemas (`TodoBase`, `CreateTodo`, `UpdateTodo`) and repository interface (`ITodoRepository`)
2. **Application** — Use cases (`createTodo`, `listTodos`, `updateTodo`, `deleteTodo`)
3. **Infrastructure** — Drizzle table definition, `TodoRepository` implementation, `mapTodoToDomain` mapper
4. **Backend** — REST/oRPC routes at `/todos` (client-server) or serverFns (fullstack) wiring repositories to use cases
5. **Web** — TanStack Start pages under `/_authenticated/todos/`

## Tech Stack

| Layer         | Technology                                 |
| ------------- | ------------------------------------------ |
| Runtime       | Bun                                        |
| Language      | TypeScript                                 |
| Monorepo      | Turborepo + Bun Workspaces                 |
| Frontend      | TanStack Start, React, TanStack Router     |
| Backend       | Elysia (Eden) or Hono (oRPC), or serverFns |
| Realtime      | Convex (optional pattern)                  |
| Mobile        | Expo (React Native)                        |
| Database      | Neon PostgreSQL, Drizzle ORM               |
| Auth          | Better Auth                                |
| UI Components | shadcn/ui, Tailwind CSS                    |
| Linting       | oxlint                                     |
| Formatting    | oxfmt                                      |
| Deployment    | Cloudflare Workers (Wrangler)              |
| Documentation | Astro Starlight                            |

## Deployment

Apps deploy to Cloudflare Workers via Wrangler. Each app has a `deploy` script:

```bash
# Deploy a kept app (example: the Elysia pattern)
cd apps/web-elysia && bun run deploy
cd apps/server-elysia && bun run deploy
```

CI (`.github/workflows/deploy-production.yml`) deploys via `cloudflare/wrangler-action`. Set Worker secrets with:

```bash
wrangler secret put DATABASE_URL
wrangler secret put BETTER_AUTH_SECRET
```

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
