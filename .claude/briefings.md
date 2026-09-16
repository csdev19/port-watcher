# Briefings binding

Where the briefings live and what regenerates them. Read by the
`generate-briefings` skill. Paths are relative to the repo root.

## Location

`apps/documentation/src/content/docs/briefings/` — served by the Astro Starlight
docs site in `apps/documentation`. Pages are `.mdx` with `title` + `description`
frontmatter and must be registered in `apps/documentation/astro.config.mjs`.

## Briefings in this repo

| Briefing         | File               | Notes                                                                      |
| ---------------- | ------------------ | -------------------------------------------------------------------------- |
| `index`          | —                  | not created; only one briefing exists so far                               |
| `pitch`          | —                  | not created                                                                |
| `ai-briefing`    | —                  | not created                                                                |
| `stack`          | —                  | not created                                                                |
| `roadmap`        | —                  | not created                                                                |
| `design-brief`   | `design-brief.mdx` | For the Tauri desktop app. Palette deliberately undecided — see Repo rules |
| `business-brief` | —                  | not created; founder not yet interviewed                                   |

## Sources of truth

| For                 | Read                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------- |
| shipped / in flight | `git log --oneline` — single-commit history, no PRs, no tags yet                            |
| desktop app surface | `apps/desktop/src-tauri/tauri.conf.json`, `src-tauri/src/lib.rs`, `src-tauri/capabilities/` |
| web app surface     | `apps/fullstack-fn-only/src/server-functions/`, `src/routes/`                               |
| schemas             | `packages/domain/src/schemas/`                                                              |
| stack               | every `package.json` + `apps/desktop/src-tauri/Cargo.toml` + `docs/adr/`                    |
| design values       | `packages/tokens/src/base.ts`, `src/themes/{light,dark}.ts`, `src/types.ts`                 |
| brand assets        | `apps/desktop/src-tauri/icons/` (Tauri defaults — not yet branded)                          |
| positioning copy    | `README.md`; no landing page yet                                                            |
| published version   | nothing published yet — no npm package, no release, no cask                                 |

## Repo rules

- Language: English on every published surface, including briefings, whatever
  language the session is in.
- Product name: **chapay** (lowercase), Quechua for "to watch, to guard". The
  full title is **"chapay — port watcher"**: brand plus descriptor, used where
  the reader has no context; `chapay` alone once context is established. Never
  "Chapay". Trademark, domain and package-registry checks are still pending.
- Safe positioning: open source, free, local-first, macOS first.
- Never claim: that it is published, installable, notarized, on Homebrew, or that
  Windows and Linux are supported. None of that is true yet.
- **The palette is deliberately not specified.** The colour direction is being
  decided in Claude Design, not in this repo. `packages/tokens` currently holds
  the monorepo template's neutral shadcn set, which is NOT the product palette.
  A future refresh may only write colour values once they actually land in
  `packages/tokens/src/themes/`.

## Validation

`bun run build --filter=documentation`
