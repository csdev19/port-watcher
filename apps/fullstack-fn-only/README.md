# fullstack-fn-only — the chapay landing

A TanStack Start app deployed as one Cloudflare Worker at `chapay.cs19.dev` (ADR 0004). Today it
serves a single route, the landing page for the chapay desktop app (`src/routes/index.tsx`). Auth
and the database are **disabled**; the code stays in the tree. The decision is in
[ADR 0005](../../docs/adr/0005-disable-web-auth-and-database.md).

## Run it

From the repository root:

```bash
bun run dev:fullstack-fn        # this app alone, on http://localhost:3002
bun run dev                     # web, docs and the desktop app together
```

On a fresh clone run `bun run setup` first (it builds the shared packages, including `web-ui`,
whose `dist/` is not committed). No `.env` is required.

## The one variable: `VITE_PUBLIC_DOWNLOAD_URL`

Optional, read at build time (`import.meta.env`). It is the public base URL of the R2 bucket that
holds the desktop installers, with no trailing slash. When set, the landing's download button
points at `<url>/download/latest/chapay-arm64.dmg` and the "Intel build" link at
`<url>/download/latest/chapay-x64.dmg`. When empty, the button falls back to the GitHub Releases
page, which is what PR validation builds and local dev use.

Production does not set it by hand: `release-web.yml` bakes it in from the `DOWNLOAD_BASE_URL`
GitHub variable, so the button and the bucket cannot disagree (ADR 0004). To try it locally, put it
in `apps/fullstack-fn-only/.env` (see `.env.example`).

## What is disabled, and how to turn it back on

Disabled: Better Auth, the sign-in and sign-up pages, the `_authenticated` layout and the todos demo,
the server functions, the session lookup in the root route, and the database. Nothing is deleted.
`packages/infra-auth`, `packages/infra-db` and `packages/infra-env` are unchanged.

To re-enable, undo these together (each disabled line carries a comment naming its partners):

1. `vite.config.ts`: remove `routeFileIgnorePattern` from the `tanstackStart` options.
2. `tsconfig.json`: remove the `exclude` entries for `src/routes/auth`, `src/routes/api`,
   `src/routes/_authenticated*`, the auth components, `src/hooks`, `src/server-functions`,
   `src/lib/auth` and `src/env`.
3. `src/routes/__root.tsx` and `src/router.tsx`: restore the commented imports, the
   `isAuthenticated` / `session` context fields, the `beforeLoad` session lookup and the `Header`.
4. `.env.example`: uncomment `DATABASE_URL`, `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL`. The names
   must also exist in `fullstackServerEnvSchema` (`packages/infra-env/src/fullstack-server.ts`).
5. CI and deploy: restore the commented lines in `.github/workflows/release-web.yml` (the secrets
   env, the "Write Worker secrets file" step, `deploy --secrets-file worker-secrets.json`, the
   cleanup step), the placeholders in `.github/workflows/pr-validation.yml`, and the variables in
   `scripts/production-env.sh`. Set `DATABASE_URL`, `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` in
   the `production` GitHub environment.
6. Install `dotenvx` (the root `db:*` scripts call it), then `bun run db:push`. Tables still use the
   template prefix `monorepo_template_`; decide whether to rename it before the first migration.
7. Run `bun run check-types`: the disabled code has not been type-checked since it was excluded, so
   expect fixes. Review the auth cookie attributes (see the Authentication docs page).

## Layout

```
src/routes/index.tsx        the landing (the only registered route)
src/routes/landing.css      landing styles
src/routes/__root.tsx       document shell
src/router.tsx              router and query client
src/routes/{auth,api,_authenticated}*   disabled, unregistered
src/components/{header,user-menu,sign-in-form,sign-up-form}.tsx, src/{hooks,lib/auth,server-functions,env}
                            disabled, excluded from tsc
wrangler.jsonc              Worker config: custom domain and static assets
```

Do not add a `vars` block to `wrangler.jsonc`; Wrangler loads `.env` itself. See the
[wrangler env config](https://github.com/csdev19/general-knowledge/blob/main/monorepos/wrangler-env-config.md)
rule in the knowledge hub.
