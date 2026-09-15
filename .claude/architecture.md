# Architecture Context

A **multi-pattern** monorepo template demonstrating DDD + Hexagonal Architecture. It ships four
interchangeable web patterns side by side; `bun run customize` keeps one and deletes the rest.

> The general architecture knowledge (DDD + hexagonal, bounded contexts, repository pattern, Result
> types, dependency injection, schema-driven validation, the Convex client connection, the
> Client-Server proxy) lives in the [general-knowledge hub](https://github.com/csdev19/general-knowledge)
> — start at [architecture/](https://github.com/csdev19/general-knowledge/blob/main/architecture/README.md)
> or the [stack recipe](https://github.com/csdev19/general-knowledge/blob/main/stacks/README.md) for
> your chosen pattern. This file only maps what is specific to _this template_.

## Layer-first package structure

```
packages/
├── domain/          # Pure: Zod schemas, types, constants, repository interfaces (leaf, no deps)
├── application/     # Use cases (depend only on domain interfaces)
├── infra-db/        # Drizzle schemas, repositories, mappers, Neon client
├── infra-auth/      # Better Auth base config
├── infra-cloudflare/# Service Binding fetch + proxy handler (client-server patterns only)
├── infra-env/       # Zod env schemas (one per app pattern)
├── convex-api/      # Convex functions for the web app (Convex pattern)
├── convex-auth-api/ # Convex functions + Better-Auth-in-Convex (mobile-convex)
├── web-ui/          # Shared React UI (shadcn/ui, Tailwind) — exports built dist/
└── config/          # Shared tsconfig
```

**Dependency rule (strict):** `domain <- application <- infra-*`; only apps wire them together.
`domain` is a leaf so importing it can never transitively pull in server code. Mobile apps import
only `domain` (and `convex-auth-api` for `mobile-convex`).

## Apps (before customize)

| App                                 | Pattern                    | Backend / data access           |
| ----------------------------------- | -------------------------- | ------------------------------- |
| `apps/web-elysia` + `server-elysia` | Client-Server Elysia       | Eden Treaty → Elysia API        |
| `apps/web-hono` + `server-hono`     | Client-Server Hono         | oRPC → Hono API                 |
| `apps/fullstack-fn-only`            | Fullstack serverFn         | TanStack Start server functions |
| `apps/fullstack-fn-and-convex`      | Fullstack Convex           | Convex (reactive)               |
| `apps/mobile`                       | Mobile (non-Convex stacks) | Shared domain + API             |
| `apps/mobile-convex`                | Mobile (Convex stack)      | Convex + Better-Auth-in-Convex  |
| `apps/documentation`                | Docs                       | Astro Starlight                 |

`bun run customize` reduces this to the chosen pattern's apps + optional mobile/docs. See the
[monorepo structure](https://github.com/csdev19/general-knowledge/blob/main/monorepos/monorepo-structure.md)
doc in the hub for the workspace/Turbo/catalog layout.
