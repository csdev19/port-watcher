# AI Assistant Context — Monorepo Template

Working notes for the template. The reusable patterns (auth, data loading, caching) differ per
chosen pattern and live in the [general-knowledge hub](https://github.com/csdev19/general-knowledge) —
link out, don't re-document.

## Auth differs by pattern

- **Client-Server (Elysia / Hono):** the web app proxies `/api/auth/*` to the API Worker
  (same-origin cookies on Cloudflare Workers via Service Bindings). Better Auth runs in the API app;
  the web app has no local auth instance. See
  [api/](https://github.com/csdev19/general-knowledge/blob/main/api/README.md).
- **Fullstack serverFn:** TanStack Start runs auth inside its own server functions.
- **Convex:** Better Auth runs **inside** the Convex deployment (`@convex-dev/better-auth`), serving
  `/api/auth/*` from Convex's HTTP router — no separate API worker, no proxy. SDK versions are pinned
  (critical on Expo SDK 57). See
  [convex/better-auth](https://github.com/csdev19/general-knowledge/blob/main/convex/better-auth.md).

## Data loading

The TanStack Query server pre-loading pattern (route `loader` + `queryClient.ensureQueryData` sharing
a `queryOptions` factory with the component hook, `keepPreviousData`, `invalidateQueries` on
mutations) is used by the non-Convex web patterns. Full write-up:
[web/data-loading](https://github.com/csdev19/general-knowledge/blob/main/web/data-loading.md). The
Convex pattern uses reactive `useQuery` subscriptions instead —
[convex/client-connection](https://github.com/csdev19/general-knowledge/blob/main/convex/client-connection.md).

## Conventions

- **Protected routes:** create under `src/routes/_authenticated/`; session is guaranteed by the
  parent `beforeLoad`. Call `router.invalidate()` after session changes so the root `beforeLoad`
  re-runs.
- **Domain is the source of truth:** Zod schemas/types live in `packages/domain/` and are reused by
  backend validation, client forms, and (Convex pattern) Convex functions.
