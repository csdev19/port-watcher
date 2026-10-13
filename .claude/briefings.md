# Briefings binding

Where the briefings live and what regenerates them. Read by the
`generate-briefings` skill. Paths are relative to the repo root.

## Location

`apps/documentation/src/content/docs/briefings/` — served by the Astro Starlight
docs site in `apps/documentation`. Pages are `.mdx` with `title` + `description`
frontmatter and must be registered in `apps/documentation/astro.config.mjs`.

## Briefings in this repo

| Briefing         | File                | Notes                                                                                                                                                                                                                      |
| ---------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index`          | —                   | not created yet; two briefings now exist, so it is due                                                                                                                                                                     |
| `pitch`          | —                   | not created                                                                                                                                                                                                                |
| `ai-briefing`    | —                   | not created                                                                                                                                                                                                                |
| `stack`          | —                   | not created                                                                                                                                                                                                                |
| `roadmap`        | —                   | not created                                                                                                                                                                                                                |
| `design-brief`   | `design-brief.mdx`  | For the Tauri desktop app. Palette deliberately undecided — see Repo rules                                                                                                                                                 |
| `business-brief` | —                   | not created; founder not yet interviewed                                                                                                                                                                                   |
| `product-brief`  | `product-brief.mdx` | Repo-specific, not a canonical briefing: shipped scope, in-flight work and owner ideas, phrased as a feature-ideation prompt. Regenerate from the desktop app surface, `gh release list`, open PRs/branches, and the owner |

## Sources of truth

| For                 | Read                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------- |
| shipped / in flight | the commit log, the tags `desktop-v*` / `web-v*`, and each app's `CHANGELOG.md`             |
| desktop app surface | `apps/desktop/src-tauri/tauri.conf.json`, `src-tauri/src/lib.rs`, `src-tauri/capabilities/` |
| web app surface     | `apps/fullstack-fn-only/src/server-functions/`, `src/routes/`                               |
| schemas             | `packages/domain/src/schemas/`                                                              |
| stack               | every `package.json` + `apps/desktop/src-tauri/Cargo.toml` + `docs/adr/`                    |
| design values       | `packages/tokens/src/base.ts`, `src/themes/{light,dark}.ts`, `src/types.ts`                 |
| brand assets        | `apps/desktop/src-tauri/icons/` (bundle and tray icons), `apps/fullstack-fn-only/public/`   |
| positioning copy    | the landing, `apps/fullstack-fn-only/src/routes/index.tsx`, and `README.md`                 |
| published version   | tags `desktop-v0.1.0` and `web-v0.1.0` (2026-10-12); no npm package, no cask                |

## Repo rules

- Language: English on every published surface, including briefings, whatever
  language the session is in.
- Product name: **chapay** (lowercase), Quechua for "to watch, to guard". The
  full title is **"chapay — port watcher"**: brand plus descriptor, used where
  the reader has no context; `chapay` alone once context is established. Never
  "Chapay". Trademark, domain and package-registry checks are still pending.
- Safe positioning: open source, free, local-first, macOS first.
- Never claim: that it is on Homebrew, that it auto-updates, or that Windows and Linux are
  supported. None of that is true. Releases are signed and notarized by `release-desktop.yml`,
  but confirm the latest tag and the download URL work before writing "available" in a briefing.
- **The palette is deliberately not specified in briefings.** The desktop panel's solid palette
  lives in `apps/desktop/src/app.module.css` (`--pw-*`), not in `packages/tokens`, which still holds
  the monorepo template's neutral shadcn set and is NOT the product palette. A briefing may only
  write colour values that exist in `app.module.css` or land in `packages/tokens/src/themes/`.

## Validation

`bun run build --filter=documentation`
