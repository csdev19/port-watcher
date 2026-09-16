# AI Assistant Context — chapay

Working notes for this repo. Reusable patterns (auth, data loading, caching) live in the
[general-knowledge hub](https://github.com/csdev19/general-knowledge) — link out, don't
re-document.

## Auth

Better Auth runs **inside** the TanStack Start server: `src/lib/auth/auth-server.ts` composes
`@port-watcher/infra-auth`'s `baseConfig` with `tanstackStartCookies()`, and
`src/routes/api/auth/$.ts` mounts `auth.handler`. One origin, so there is no proxy and no CORS
allowlist. `getAuthSession` is a server function reading the session from request headers; the root
route puts it into the router context.

## Data loading

TanStack Query server pre-loading: route `loader` + `queryClient.ensureQueryData` sharing a
`queryOptions` factory with the component hook, `keepPreviousData`, `invalidateQueries` on
mutations. Full write-up:
[web/data-loading](https://github.com/csdev19/general-knowledge/blob/main/web/data-loading.md).

## Conventions

- **Protected routes:** create under `src/routes/_authenticated/`; the parent `beforeLoad` redirects
  unauthenticated visitors. That guard is UX only — **every server function must re-check the
  session itself** before touching data. Call `router.invalidate()` after session changes so the
  root `beforeLoad` re-runs.
- **Server functions are adapters:** validate input with a domain schema, check the session, build
  the repository, call the use case. No business logic in `src/server-functions/`.
- **Domain is the source of truth:** Zod schemas/types live in `packages/domain/` and are reused by
  server-function validation and client forms.
