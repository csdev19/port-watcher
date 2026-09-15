---
name: feature-docs
description: Template and format for feature documentation. Use when
  creating or updating feature docs. Also use when the user asks to
  document a feature, save feature context, or update the changelog.
  Provides templates for parent index pages, sub-feature docs, and
  changelog entries.
---

# Feature Documentation Templates

## Configuration

Update these values to match your project's documentation setup.
All paths and templates below are derived from these values.

| Variable         | Value                                 | Description                                                        |
| ---------------- | ------------------------------------- | ------------------------------------------------------------------ |
| DOCS_BASE        | `apps/documentation/src/content/docs` | Root path for documentation files                                  |
| DOCS_EXT         | `.mdx`                                | File extension (`.mdx` for Astro Starlight, `.md` for plain)       |
| INDEX_FILE       | `index.mdx`                           | Index file name (`index.mdx` for Starlight, `README.md` for plain) |
| USES_FRONTMATTER | `true`                                | Whether files need YAML frontmatter (`title`, `description`)       |

---

This skill defines the exact format for all feature documentation.
There are three templates: Parent Index, Sub-Feature Doc, and Changelog.

ALWAYS follow these templates exactly. Do not add extra sections.
Do not skip sections — if a section has no content, write "None" or "N/A".

When USES_FRONTMATTER is `true`, every file MUST include a YAML frontmatter
block with `title` and `description` fields.

---

## Parent Index Template

Location: `{DOCS_BASE}/features/{parent}/{INDEX_FILE}`

Purpose: Index and shared context for a feature area. This is what Claude
reads FIRST when working on any sub-feature in this area.

Keep this file SHORT. Shared decisions and gotchas only — details go in
sub-feature docs.

```mdx
---
title: {Feature Name}
description: {One-line description of the feature area}
---

# {Feature Name}

## Architecture Overview

- Domain: `{path to domain layer}`
- Infrastructure: `{path to infrastructure layer}`
- Web UI: `{path to web routes/components}`
- Mobile: `{path to mobile feature}` (if applicable)
- Desktop: `{path to desktop feature}` (if applicable)

## Sub-Features

| Feature | Status | Date | Summary |
|---------|--------|------|---------|
| [{Sub-Feature Name}]({sub-feature-name}) | ✅ | YYYY-MM-DD | {one-line summary} |

## Shared Decisions

| Decision | Why |
|----------|-----|
| {decision that applies to ALL sub-features} | {reasoning} |

## Shared Gotchas

- ⚠️ {Warning that applies across all sub-features in this area}
```

Status icons:

- ✅ Complete
- 🚧 In Progress
- 📋 Planned
- ⚠️ Needs Attention
- 🗑️ Deprecated

---

## Sub-Feature Template

Location: `{DOCS_BASE}/features/{parent}/{sub-feature-name}{DOCS_EXT}`

Purpose: Full context for a specific sub-feature. This is what Claude reads
when working on this specific sub-feature.

````mdx
---
title: {Sub-Feature Name}
description: {One-line description}
---

# {Sub-Feature Name}

## Status

| Field          | Value                    |
|----------------|--------------------------|
| Status         | ✅ Complete / 🚧 WIP     |
| Completed      | YYYY-MM-DD               |
| Author         | {who built it}           |
| Parent Feature | [{Parent}](index)        |
| Related Issues | {links if any}           |

## What It Does

{2-3 sentences explaining this sub-feature from a user perspective}

## Implementation

### Files Changed

| Path | Purpose |
|------|---------|
| `path/to/file.ts` | {what this file does for this sub-feature} |

### Domain Model

{Entities, Value Objects, Aggregates involved — or "N/A" if not applicable}

### Key Logic

{Brief explanation of the core implementation approach. NOT a code dump —
describe the pattern/algorithm/flow in 3-5 sentences max.}

## Decisions

| Decision | Why | Alternatives Considered |
|----------|-----|------------------------|
| {decision} | {reasoning} | {what else was considered} |

## Gotchas & Warnings

- ⚠️ {Thing that would trip someone up}
- ⚠️ {Non-obvious behavior or limitation}

## Dependencies

{New packages, services, env vars, or APIs introduced — or "None"}

## Testing

```bash
# Unit tests
{specific command}

# E2E tests
{specific command}

# Manual testing
{steps to manually verify}
```

## Related

- [{Other sub-feature}]({other-sub-feature}) — {how they relate}
- {Links to external docs, ADRs, or API references}
````

---

## Changelog Entry Template

Location: `{DOCS_BASE}/changelog/{YYYY-MM-DD}-{short-kebab-title}{DOCS_EXT}` — **one file per entry**.

Purpose: Global log of all feature work across the project — the "why" behind
each change, not a commit list.

The index (`{DOCS_BASE}/changelog/{INDEX_FILE}`) is **auto-generated** from the
entry files by `src/components/ChangelogIndex.astro` (newest first, sorted by
the filename's date prefix — the prefix is mandatory). **Never edit the index**;
creating the entry file is all it takes. This avoids per-entry index edits and
the merge conflicts they cause.

The frontmatter `description` must be short (1-2 lines): it becomes the index
card text.

```mdx
---
title: "{Month DD, YYYY} - {Feature name}"
description: { 1-2 line summary — index card text }
date: { YYYY-MM-DD }
tags:
  - changelog
  - { feature | bugfix | ... }
---

{Type icon} **{Type}** — {What changed and why, 1-3 sentences.}

**Docs:** [{name}](/features/{parent}/{sub-feature})
```

Type icons:

- ✨ Feature — New capability
- 🐛 Fix — Bug fix
- 🔄 Refactor — Internal change, no user-facing difference
- 📝 Docs — Documentation only
- ⚡ Performance — Optimization
- 🔒 Security — Security fix
- 💄 UI — Visual/UX change
- ♻️ Migration — Database or data migration

---

## Rules

1. NEVER put code snippets in feature docs. Describe patterns and approaches
   in words. Code changes — docs stay relevant.
2. Keep sub-feature docs under 80 lines. If it's longer, you're including
   too much detail. Be concise.
3. Gotchas are the MOST valuable section. Prioritize non-obvious information
   that would save someone 30+ minutes of debugging.
4. Decisions table should document WHY, not WHAT. The code shows what —
   the doc explains why that choice was made over alternatives.
5. Always link back to parent index from sub-feature docs.
6. Always update the parent index sub-features table when adding a new doc.
7. Dates use ISO format: YYYY-MM-DD.
8. When USES_FRONTMATTER is `false`, omit the `---` frontmatter blocks from
   templates and use the markdown `# Title` and `> description` format instead.
