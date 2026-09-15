---
name: customize-template
description: Provides complete context for customizing this monorepo template. Knows which apps, packages, scripts, CI/CD steps, and dependencies to remove based on the user's chosen architecture pattern. Use when the user wants to strip down the template to only what they need.
---

# Customize Monorepo Template

## Quick Start: Automated Scripts

The template ships with two scripts that handle customization automatically:

### `bun run customize` — Full interactive customization

Handles everything in one command:

- Prompts for architecture pattern, mobile, docs, Convex, project name
- Deletes unused directories, cleans package.json, generates CI/CD, renames scope
- Applies pattern-specific source fixups (see `postProcess` below)
- Runs verification (install, build, type-check)
- Self-deletes after completion

### `bun run rename <scope>` — Standalone rename

Replaces `@monorepo-template` across all 60+ files. Use if you only need to rename.

```bash
bun run rename raiko  # @monorepo-template -> @raiko everywhere
```

**Always recommend running `bun run customize` first.** Only fall back to manual steps if the script fails or needs adjustment.

---

## Template Inventory (Reference)

### Apps

| App                       | Path                            | Purpose                                               |
| ------------------------- | ------------------------------- | ----------------------------------------------------- |
| `web-elysia`              | `apps/web-elysia/`              | TanStack Start web app for the Elysia pattern         |
| `server-elysia`           | `apps/server-elysia/`           | Elysia API Worker                                     |
| `web-hono`                | `apps/web-hono/`                | TanStack Start web app for the Hono pattern           |
| `server-hono`             | `apps/server-hono/`             | Hono + oRPC API Worker                                |
| `fullstack-fn-only`       | `apps/fullstack-fn-only/`       | Fullstack with TanStack serverFn only (no API server) |
| `fullstack-fn-and-convex` | `apps/fullstack-fn-and-convex/` | Fullstack with TanStack serverFn + Convex real-time   |
| `mobile`                  | `apps/mobile/`                  | Expo app for the non-Convex stacks                    |
| `mobile-convex`           | `apps/mobile-convex/`           | Expo app with Better-Auth-in-Convex                   |
| `documentation`           | `apps/documentation/`           | Documentation site (Astro Starlight)                  |
| `desktop`                 | `apps/desktop/`                 | Local-first Electron app (electron-vite + SQLite)     |

### Packages

| Package                               | Path                         | Purpose                                    |
| ------------------------------------- | ---------------------------- | ------------------------------------------ |
| `@monorepo-template/domain`           | `packages/domain/`           | Pure domain layer: schemas, types, consts  |
| `@monorepo-template/application`      | `packages/application/`      | Use cases layer (server-only)              |
| `@monorepo-template/infra-db`         | `packages/infra-db/`         | Drizzle ORM, Neon PostgreSQL, repositories |
| `@monorepo-template/infra-auth`       | `packages/infra-auth/`       | Better Auth configuration                  |
| `@monorepo-template/infra-cloudflare` | `packages/infra-cloudflare/` | Service Binding fetch + proxy handler      |
| `@monorepo-template/infra-env`        | `packages/infra-env/`        | Zod env validation schemas                 |
| `@monorepo-template/i18n`             | `packages/i18n/`             | use-intl en/es catalogs, provider, core    |
| `@monorepo-template/web-ui`           | `packages/web-ui/`           | Shared React UI components (shadcn/ui)     |
| `@monorepo-template/tokens`           | `packages/tokens/`           | Design tokens (web + desktop stylesheets)  |
| `@monorepo-template/convex-api`       | `packages/convex-api/`       | Convex functions for the web app           |
| `@monorepo-template/convex-auth-api`  | `packages/convex-auth-api/`  | Convex functions + Better-Auth-in-Convex   |
| `@monorepo-template/config`           | `packages/config/`           | Shared tsconfig.base.json                  |

### Architecture Patterns (Mutually Exclusive)

| Pattern                 | Keep                                     | Notes                                                        |
| ----------------------- | ---------------------------------------- | ------------------------------------------------------------ |
| Client-Server Elysia    | `apps/web-elysia` + `apps/server-elysia` | Eden Treaty client                                           |
| Client-Server Hono      | `apps/web-hono` + `apps/server-hono`     | oRPC client                                                  |
| **Backend only**        | `apps/server-hono`                       | No client at all; keeps `i18n`, drops `web-ui`/`tokens`      |
| Fullstack serverFn      | `apps/fullstack-fn-only`                 | Drops `infra-cloudflare` and `wrangler`                      |
| Fullstack + Convex      | `apps/fullstack-fn-and-convex`           | Keeps `wrangler`; mobile variant is `mobile-convex`          |
| **Desktop local-first** | `apps/desktop`                           | No server, no web client; drops every `infra-*` and `config` |

Every pattern removes the apps of the others, plus the mobile variant it does not pair with. `packages/i18n` and `packages/tokens` are removed by default (`UNUSED_PACKAGES`) — a pattern opts out via its `unusedPackages` field, and **keeping the desktop app rescues both** (see `survivingUnusedPackages`), because its renderer imports `tokens` for the stylesheet and `i18n` for the UI and the tray.

### Optional add-ons

`mobile`, `documentation` and `desktop` are prompted independently of the pattern (`--mobile`,
`--docs`, `--desktop`). The desktop app is the only add-on that also changes which _packages_
survive, and it is the only one with committed rather than generated workflows — `ci-desktop.yml`
and `release-desktop.yml` are deleted by hand when the app is dropped (`DESKTOP_WORKFLOWS`).

### The desktop pattern

`desktop-local-first` sets `deploy: "desktop-release"`, which suppresses the generated
`deploy-production.yml`: there is no Worker to deploy, and the app ships from a `desktop-v*` tag
through the committed `release-desktop.yml`. It is also the only pattern that deletes
`packages/infra-env` outright, so step 4 skips rewriting that package's `index.ts`.

### The backend-only pattern

Choose it when the service is consumed by products in **other repositories**: a centralized auth, billing, or notification service. It differs from the others in three ways worth knowing:

- **`mobileApp: null`** — there is no mobile counterpart, so the mobile prompt is skipped entirely.
- **`unusedPackages: ["packages/tokens"]`** — `i18n` survives, because a headless service still renders localized transactional email and push copy through the package's non-React `core` export.
- **`postProcess: serverOnlyFixups`** — see below.

The `postProcess` step is what makes the generated repo actually build. `apps/server-hono` ships assuming a web app in front of it: it depends on `@better-auth/expo` for the mobile client, and hardcodes CORS to `exp://` because web traffic arrived same-origin through the web Worker's Service Binding proxy. With no client in the monorepo both assumptions are wrong — and since this pattern drops `@better-auth/expo` from the catalog, leaving the dependency in place breaks `bun install` outright. The fixup removes the dependency, rewrites `src/lib/auth.ts` without the Expo plugin, and points both CORS and Better Auth's `trustedOrigins` at `CORS_ORIGIN`.

Full write-up of the resulting topology: [service-only-hono recipe](https://github.com/csdev19/general-knowledge/blob/main/stacks/service-only-hono.md) and [centralized auth service](https://github.com/csdev19/general-knowledge/blob/main/api/centralized-auth-service.md).

### Adding a new pattern

Everything lives in `scripts/customize.ts`:

1. Add the key to the `Pattern` union.
2. Add a `PatternConfig` entry — `keep`, `mobileApp`, `unusedPackages`, `remove`, `scriptsRemove`, `catalogRemove`, `envSchemasRemove`, `dbEnvSource`, `deploy`, and the `ci*` fields.
3. Add the label to the `choose(...)` prompt **and** the matching key to `patternKeys`, at the same index.
4. If the pattern needs source edits beyond deleting directories, add a `postProcess` function. It runs before the rename, so write `@monorepo-template` imports and let the rename step translate them.

For CI, `ciAppDir` is what gets deployed. A pattern whose app _is_ the backend sets `ciNeedsBackend: false` — the standard app deploy step already handles it, and no extra backend step is appended.

### Optional Features

**Mobile:** If removed, also remove the `dev:native` script and `@better-auth/expo` from the catalog. Backend-only skips the prompt.

**Convex:** If not using Convex, `customize` removes `scripts/generate-convex-jwt-keys.ts` and the `generate:convex-jwt-keys` script.

---

## Post-Script Manual Steps

The script regenerates `README.md` for the chosen pattern, but cannot rewrite
the other prose docs. After running `bun run customize`, check:

| File                      | What to update                                                    |
| ------------------------- | ----------------------------------------------------------------- |
| `CLAUDE.md`               | Architecture examples referencing deleted apps                    |
| `.claude/architecture.md` | References to deleted apps                                        |
| `.claude/ai-context.md`   | References to deleted app paths                                   |
| `apps/documentation/`     | Pages and `astro.config.mjs` sidebar entries for deleted patterns |

Grep for stale references:

```bash
grep -rn "web-elysia\|web-hono\|fullstack\|mobile\|convex\|web-ui" --include="*.md" --include="*.mdx" .claude/ CLAUDE.md apps/documentation/
```

The docs site is the biggest one: its auth pages describe the web app's proxy
flow, which does not exist in the backend-only pattern.

---

## Rename Scope Details

The `bun run rename` script replaces both `@monorepo-template` (scope) and `monorepo-template` (bare name) across all files, excluding `node_modules`, `.git`, `bun.lock`, `.turbo`, `dist`, `.output`, `.wrangler`, `.next`.

Files typically affected (~60+):

- All `package.json` files (root + packages + apps)
- Source files with `import ... from "@monorepo-template/..."`
- CI/CD workflows (`--filter='@monorepo-template/*'`)
- `CLAUDE.md`
- Documentation `.mdx` files
- `.claude/` context files
- Lint/format configs

The replacement is textual and unconditional, so it also rewrites prose that
mentions the old scope by name. Re-read any doc that discussed
`@monorepo-template` as a _subject_ after renaming.
