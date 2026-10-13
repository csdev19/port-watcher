# port-watcher

Monorepo for **chapay — port watcher**: a macOS menu-bar app that lists the TCP ports in `LISTEN`
and kills the process behind one. Bun, Turborepo, TypeScript and Rust.

- `apps/desktop` is the product: a Tauri 2 app with a Rust core and a React renderer.
- `apps/fullstack-fn-only` serves the landing page (`chapay.cs19.dev`) as one Cloudflare Worker.
  Auth and the database are disabled for now; see its README.
- The `packages/*` workspace is a DDD + Hexagonal template (a Todo example) that the desktop app
  does not import. It is kept on purpose; see [Packages](#packages).

## Getting Started

macOS only. `bun run setup` checks the Apple developer tools and Rust, installs dependencies and
builds the shared packages; rerun it after fixing anything it reports.

```bash
bun run setup
bun run dev
```

`bun run dev` starts the landing, the docs site and the Tauri desktop app together. There is no
`.env` step: the web app reads no required variables (auth and the database are off).

## Apps

- `apps/fullstack-fn-only` — TanStack Start app (client + server functions), deployed as one Cloudflare Worker
- `apps/documentation` — Astro Starlight documentation site
- `apps/desktop` — **chapay**, the Tauri 2 menu-bar app: React + Vite renderer, Rust core in `src-tauri/`

## Packages

`domain` · `application` · `infra-db` · `infra-auth` · `infra-env` · `web-ui` · `tokens` · `i18n` · `config`

`domain` and `application` hold only the Todo example, and `infra-db` / `infra-auth` back the
disabled auth. The real chapay logic lives in the Rust core and in `apps/desktop/src/lib`; the
desktop app imports only `@port-watcher/config` (tsconfig). The owner kept these packages
deliberately (#27), so treat them as dormant template packages, not as the product's domain.

## Scripts

- `bun run setup` — bootstrap a fresh macOS clone
- `bun run dev` — web, docs and the Tauri app · `bun run dev:fullstack-fn` — just the web app
- `bun run dev:desktop` — run the Tauri app · `bun run build:desktop` — bundle it (needs Rust)
- `bun run build` — build for production
- `bun run check-types` — typecheck · `bun run test` — tests
- `bun run lint` / `bun run format` — lint / format
- `bun run db:push` / `db:studio` / `db:generate` / `db:migrate` — database; only meaningful once
  auth and the database are re-enabled, and they need a global `dotenvx`

## Architecture

DDD + Hexagonal, layer-first packages. The dependency rule is strict:
`domain <- application <- infra-*`, and only apps wire them together. See `CLAUDE.md` and
`.claude/architecture.md`.
