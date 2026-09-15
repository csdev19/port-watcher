# .claude/commands/save-feature.md

---

description: Document a completed feature or sub-feature with context, decisions, and gotchas. Supports nested structure (parent/sub-feature).
allowed-tools: Read, Edit, Write, Glob, Grep, Bash(git log:_), Bash(git diff:_), Bash(git branch:_), Bash(ls:_), Bash(find:_), Bash(date:_)
argument-hint: [parent-feature/sub-feature-name]

---

# Save Feature Documentation

## Step 1: Read configuration

Read the **Configuration** section from `.claude/skills/feature-docs/SKILL.md` to get:

- `DOCS_BASE` — root path for all documentation files
- `DOCS_EXT` — file extension (`.mdx` or `.md`)
- `INDEX_FILE` — name of index files (`index.mdx` or `README.md`)
- `USES_FRONTMATTER` — whether files need YAML frontmatter

Use these values for ALL paths in the steps below. Resolved paths follow this pattern:

- Feature folder: `{DOCS_BASE}/features/{parent}/`
- Parent index: `{DOCS_BASE}/features/{parent}/{INDEX_FILE}`
- Sub-feature doc: `{DOCS_BASE}/features/{parent}/{sub-feature}{DOCS_EXT}`
- Changelog entry: `{DOCS_BASE}/changelog/{YYYY-MM-DD}-{short-kebab-title}{DOCS_EXT}` (the index is auto-generated — never edit it)

## Step 2: Identify the feature

If $ARGUMENTS is provided, parse the format:

- `parent/sub-feature` (e.g., "checklist/recurring-tasks") → nested doc
- `feature-name` alone (e.g., "whatsapp-integration") → could be a main feature or a sub-feature

If format is a single name, check:

1. Run `ls {DOCS_BASE}/features/` to see existing feature folders
2. Ask the user: "Does this belong to an existing feature group?"
   - Show the list of existing folders
   - If yes → treat as sub-feature under that parent
   - If no → treat as a new main feature area

If $ARGUMENTS is empty, ask the user:

1. What is the main feature area? (e.g., checklist, whatsapp, orders)
2. Is this a new main feature or a sub-feature of an existing one?
3. What is the sub-feature name? (kebab-case, e.g., "recurring-tasks")
4. One-line description of what it does

Always confirm with the user before proceeding:
"I'll document this as: `{DOCS_BASE}/features/{parent}/{sub-feature}{DOCS_EXT}` — correct?"

## Step 3: Gather context from the session

Reflect on the current session and gather:

1. **What was built** — Which files were created/modified? Run:
   ```bash
   git diff --name-only main...HEAD 2>/dev/null || git diff --name-only --cached
   ```
2. **Key decisions** — What architectural or technical decisions were made and why?
3. **Gotchas discovered** — What unexpected issues came up? What would trip up the next developer?
4. **Dependencies** — Any new packages, services, or APIs introduced?
5. **How to test** — Specific test commands for this feature
6. **Related sub-features** — Does this affect or depend on other sub-features in the same parent?

If the session context is insufficient (e.g., running this in a fresh session),
ask the user to provide a brief summary of:

- What was implemented
- Any decisions or gotchas worth documenting

## Step 4: Read the templates

Read the templates from `.claude/skills/feature-docs/SKILL.md` and follow
their format exactly.

## Step 5: Ensure folder structure exists

### For a new main feature (parent folder doesn't exist):

1. Create `{DOCS_BASE}/features/{parent}/` folder
2. Create `{DOCS_BASE}/features/{parent}/{INDEX_FILE}` using the **Parent Index Template**
3. Create the sub-feature doc at `{DOCS_BASE}/features/{parent}/{sub-feature}{DOCS_EXT}`

### For a sub-feature under an existing parent:

1. Create the sub-feature doc at `{DOCS_BASE}/features/{parent}/{sub-feature}{DOCS_EXT}`
2. Update `{DOCS_BASE}/features/{parent}/{INDEX_FILE}` — add a row to the Sub-Features table

### For a standalone feature (no sub-features yet):

1. Create `{DOCS_BASE}/features/{feature}/` folder
2. Create `{DOCS_BASE}/features/{feature}/{INDEX_FILE}` with overview
3. If there's specific sub-feature content, create the sub-feature doc
4. If it's simple enough to fit in the index alone, keep it there until complexity grows

## Step 6: Generate the documentation

- Sub-feature doc → using **Sub-Feature Template**
- Parent index → create or update using **Parent Index Template**

Get today's date with:

```bash
date +%Y-%m-%d
```

Follow the template format strictly. Do not invent sections that aren't in the template.

## Step 7: Add changelog entry

Create a new entry **file** `{DOCS_BASE}/changelog/{YYYY-MM-DD}-{short-kebab-title}{DOCS_EXT}`
using the Changelog Entry Template from the template skill. Link to the sub-feature
doc, not the parent index.

**Do NOT edit `changelog/{INDEX_FILE}`** — it is auto-generated from the entry files
(newest first by filename date prefix); creating the entry file is all it takes.

## Step 8: Update CLAUDE.md pointer (if needed)

Only add a pointer if this is a **new main feature area** not yet referenced
in any CLAUDE.md file. Don't add pointers for every sub-feature.

Format: `For {feature} details, see {DOCS_BASE}/features/{parent}/{INDEX_FILE}`

Check if a subdirectory CLAUDE.md (e.g., `apps/<app>/CLAUDE.md` or
`packages/core/CLAUDE.md`) is more appropriate than the root CLAUDE.md.

## Step 9: Present summary

Show the user:

- Path to the new/updated doc files
- Changelog entry added
- Any CLAUDE.md updates made
- Updated sub-features table in parent index

Ask: "Want me to commit these documentation changes?"
