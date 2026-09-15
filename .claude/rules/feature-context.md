---
paths: [packages/**/*.ts, apps/**/*.ts]
---

Before modifying an existing feature, check if a matching folder
exists in the feature docs directory. To resolve the correct path:

1. Read the **Configuration** section from `.claude/skills/feature-docs/SKILL.md`
   to get `DOCS_BASE`, `DOCS_EXT`, and `INDEX_FILE`
2. Check if `{DOCS_BASE}/features/{feature-name}/` exists
3. If it does:
   - Read `{DOCS_BASE}/features/{feature-name}/{INDEX_FILE}` for architecture overview and shared decisions
   - If working on a specific sub-feature, read that sub-feature's doc (`{sub-feature}{DOCS_EXT}`)
   - Respect any gotchas or decisions documented there
4. Do NOT read unrelated sub-feature docs. Only read the index + the specific sub-feature you need.
