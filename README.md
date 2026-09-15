# port-watcher

Monorepo for **chapay — port watcher** — DDD + Hexagonal Architecture, TypeScript, Bun and
Turborepo.

The web side is a single TanStack Start app (`apps/fullstack-fn-only`) whose server functions call
the same use cases any API worker would; there is no separate backend and no auth proxy. The Tauri 2
desktop app (`apps/desktop`) lives alongside it and can reuse `packages/domain` and
`packages/application`.

## Getting Started

```bash
bun install

# web-ui exports built files and dist/ is not committed — build the packages first
bun run build --filter='@port-watcher/*'

cp apps/fullstack-fn-only/.env.example apps/fullstack-fn-only/.env  # then fill it in
bun run db:push
bun run dev
```

## Apps

- `apps/fullstack-fn-only` — TanStack Start app (client + server functions), deployed as one Cloudflare Worker
- `apps/documentation` — Astro Starlight documentation site
- `apps/desktop` — **chapay**, the Tauri 2 menu-bar app: React + Vite renderer, Rust core in `src-tauri/`

## Packages

`domain` · `application` · `infra-db` · `infra-auth` · `infra-env` · `web-ui` · `tokens` · `i18n` · `config`

## Scripts

- `bun run dev` — start the web apps · `bun run dev:fullstack-fn` — just the web app
- `bun run dev:desktop` — run the Tauri app · `bun run build:desktop` — bundle it (needs Rust)
- `bun run build` — build for production
- `bun run check-types` — typecheck · `bun run test` — tests
- `bun run lint` / `bun run format` — lint / format
- `bun run db:push` / `db:studio` / `db:generate` / `db:migrate` — database

## Architecture

DDD + Hexagonal, layer-first packages. The dependency rule is strict:
`domain <- application <- infra-*`, and only apps wire them together. See `CLAUDE.md` and
`.claude/architecture.md`.
