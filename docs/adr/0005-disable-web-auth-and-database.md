# ADR 0005: disable web auth and the database until the web app needs accounts

**Status:** accepted; implemented on `main` by PR #27 (commit `ab63d0e`, 2026-10-11). This ADR
promotes the decision out of the amendment in [ADR 0004](0004-public-hostnames-and-release-variables.md).
**Date:** 2026-10-13 (decision taken 2026-10-11).

## Context

`apps/fullstack-fn-only` was cloned from a monorepo template: Better Auth, a Drizzle/Postgres
database, a todos demo and a session lookup in the root route. chapay's web app is only the
landing page for the desktop app. With the template intact, every visit to the landing ran a
session lookup, so production needed `DATABASE_URL`, `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL`
(and a Postgres) for a page that shows no account feature. The release pipeline, the
`production-env.sh` loader and the PR validation build all carried placeholders for them.

The same PR also corrected the R2 bucket name (`chapay-bucket`); that part is recorded in ADR 0004.

## Decision

Disable auth and the database without deleting anything:

- Unregister the `auth`, `api` and `_authenticated` routes with `routeFileIgnorePattern` in
  `apps/fullstack-fn-only/vite.config.ts`. The route files stay in the tree.
- Exclude the code those routes use from `apps/fullstack-fn-only/tsconfig.json`: `src/routes/auth`,
  `src/routes/api`, `src/routes/_authenticated*`, `src/components/{header,user-menu,sign-in-form,sign-up-form}.tsx`,
  `src/hooks`, `src/server-functions`, `src/lib/auth` and `src/env`.
- Comment out (not delete) the session lookup, the app header and the `isAuthenticated` / `session`
  router context in `__root.tsx` and `router.tsx`.
- Comment out the `DATABASE_URL`, `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` lines in
  `.env.example`, `release-web.yml`, `pr-validation.yml` and `scripts/production-env.sh`, and deploy
  the Worker without `--secrets-file` (it has no secrets).
- Leave `packages/infra-auth`, `packages/infra-db`, `packages/infra-env`, `domain` and
  `application` unchanged. The owner kept them on purpose (#27) as dormant template packages.

How to turn it back on is documented in `apps/fullstack-fn-only/README.md`; every disabled line
carries a comment saying which other lines must be restored with it.

## Alternatives rejected

- **Delete the auth, todos and database code and packages.** Cleanest tree, but the owner expects
  accounts later and the template code is already integrated and typed. Deleting is a separate,
  deliberate decision (post-release audit item 3.1), not part of this change.
- **Keep auth enabled with placeholder secrets.** The landing would still run a session lookup and
  open a database connection on every request, and production would carry secrets for nothing.
- **Make the session lookup optional at runtime (feature flag).** Needs the env schema to treat the
  variables as optional and keeps the dead routes registered, so a broken route is still reachable
  in production. A build-time switch fails earlier.

## Consequences

- The landing needs no server environment variables. `VITE_PUBLIC_DOWNLOAD_URL` is the only
  variable the shipped code reads, and it is optional.
- `fullstackServerEnvSchema` (`packages/infra-env`) and `src/env/server.ts` are not compiled into the
  app today, so they cannot catch a missing variable at boot until the server code returns.
- The disabled code is excluded from type checking, so it can rot silently. Re-enabling it will
  likely need dependency and type fixes.
- The root `db:*` scripts still exist but target a database nothing uses, and they need a global
  `dotenvx` (not installed).
- Table names still use the template prefix `monorepo_template_` (`packages/infra-db`). Renaming it
  before the first real migration is cheaper than after.
- Documentation that described auth as live (`authentication.mdx`, `environment-variables.mdx`,
  the docs index) now marks it dormant.

## Non-goals

- Deleting or archiving any package (item 3.1 of the post-release audit, pending an owner decision).
- Removing the todos demo.
- Designing the future account model.

## Reopen when

- The web app needs accounts or stored data: restore the commented lines together, then review the
  cookie attributes (`sameSite: "none"` is inherited from the template) and re-check that every
  server function validates the session itself.
- The owner decides to delete the dormant packages (audit item 3.1): this ADR is then superseded
  by that decision.
- The disabled code stays disabled long enough to rot (for example, a dependency upgrade breaks it):
  delete it rather than maintain it unseen.
