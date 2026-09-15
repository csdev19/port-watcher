# .claude/commands/customize-template.md

---

description: Customize this monorepo template by choosing your architecture pattern, optional features, and project name. Removes everything you don't need.
allowed-tools: Bash(bun run customize:_), Bash(bun run rename:_), Read, Grep, Edit, AskUserQuestion

---

# Customize Monorepo Template

## Primary Method: Run the interactive script

The template ships with an automated customization script that handles everything:

```bash
bun run customize
```

This script will:

1. Ask for architecture pattern (Client-Server Elysia/Hono, Fullstack serverFn, Fullstack + Convex)
2. Ask about optional features (mobile, docs, Convex)
3. Ask for a project name to rename `@monorepo-template` scope
4. Delete unused app directories
5. Clean up root package.json (scripts, catalog dependencies)
6. Clean up infra-env schemas
7. Generate correct CI/CD workflows
8. Clean up lint configs
9. Regenerate a minimal README for the chosen pattern
10. Run the rename across all files
11. Run `bun install`, `bun run build`, `bun run check-types` verification

**Run this first.** It handles ~95% of the customization work in under 30 seconds.

## Post-Script Cleanup

The script regenerates `README.md` for the chosen pattern. After it completes,
check these files that may still reference deleted apps:

1. **CLAUDE.md** — Update architecture examples if they reference deleted apps
2. **.claude/architecture.md** — May reference deleted apps/server, apps/web
3. **.claude/ai-context.md** — May reference deleted app paths

Use Grep to find remaining references:

```bash
grep -r "apps/web\|apps/server\|apps/fullstack" --include="*.md" .claude/ CLAUDE.md
```

Fix any stale references found.

## Standalone Rename (if needed separately)

To rename the project scope without full customization:

```bash
bun run rename <new-scope>
# Example: bun run rename raiko  ->  @monorepo-template becomes @raiko
```

This updates all 60+ files containing `@monorepo-template` and runs `bun install`.
