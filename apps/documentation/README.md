# documentation — chapay docs site

The documentation site for **chapay — port watcher**, built with
[Astro Starlight](https://starlight.astro.build). It covers using the desktop app, developing it,
releasing it, and the architecture patterns of the monorepo.

## Layout

```
src/content/docs/    pages (.md / .mdx), one route per file
  desktop/           install, usage, permissions, development and release pages
  architecture/ …    monorepo and template architecture guides
  backlog/           planned work
  changelog/         feature changelog entries
src/components/      Astro components used by pages
astro.config.mjs     title, sidebar, integrations (Mermaid)
```

Every page needs `title` and `description` frontmatter (the changelog also uses `date` and `tags`,
see `src/content.config.ts`). A new page must be added to the `sidebar` in `astro.config.mjs`
unless it lives in an `autogenerate` directory.

## Commands

Run from the repository root:

| Command                                    | Action                                       |
| :----------------------------------------- | :------------------------------------------- |
| `bun run dev`                              | Start the docs with the other apps           |
| `bun run --cwd apps/documentation dev`     | Start only this site (`localhost:4321`)      |
| `bun run --cwd apps/documentation build`   | Build the site to `apps/documentation/dist/` |
| `bun run --cwd apps/documentation preview` | Preview the build                            |

The pages that explain the shared packages assume `bun run build --filter='@port-watcher/*'` has
run once on a fresh clone; the docs build itself does not import them.
