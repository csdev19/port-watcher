---
name: plan-to-backlog
description: Use when an approved implementation plan in docs/superpowers/plans/ must become executable backlog documents for parallel runner agents — after writing-plans finishes, or when the user asks to "convert the plan to backlog", "prepare the epic", or "create the runner docs".
---

# Plan → Backlog Conversion

Convert an approved implementation plan into an epic + per-deliverable docs in the
documentation app, so independent runner agents can execute them in parallel. The
backlog docs become the **execution source**; the plan is superseded.

**Why this pattern exists (read once):**
[general-knowledge → conventions/plan-to-backlog](https://github.com/csdev19/general-knowledge/blob/main/conventions/plan-to-backlog.md)
— runners see only their own doc, so docs must be self-sufficient; real dependencies
come from Interfaces blocks, not lane diagrams; parallelism only from disjoint files.

## Configuration

Update these values to match your project's documentation setup.

| Variable  | Value                                                                                                                                                                                                             |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BACKLOG   | `apps/documentation/src/content/docs/backlog`                                                                                                                                                                     |
| PLANS     | `docs/superpowers/plans`                                                                                                                                                                                          |
| EXT       | `.mdx` (Astro Starlight — frontmatter `title` + `description` required)                                                                                                                                           |
| EXEMPLARS | This repo's first converted epic becomes the exemplar; until then, follow the hub doc linked above (real examples live in the `language-cards` repo: `furigana-tokens` E1–E7, `particle-sound-tap-explain` P1–P9) |

## Output inventory (all of these, every time)

1. **Epic doc** `{BACKLOG}/<epic-slug>.mdx` — sections in order: status line
   (`**Status:** 🔵 Propuesto · **Area:** … · **Effort:** …`), Problem/opportunity,
   Source documents (spec + plan, plan marked "**superseded — do not execute from
   there**"), Architecture paragraph, Deliverables table (name · depends-on · link),
   ASCII dependency graph, **Parallel-safe lanes justified by file collisions**
   (docs that share a file are never parallel), Rules for every runner, Global
   constraints hoisted from the plan, Shared vocabulary (who produces / who
   consumes each exported name).
2. **One doc per deliverable** `{BACKLOG}/<epic-short>-p<N>-<slug>.mdx` — status
   line + `**Depends on:** … · **Parallel with:** …` + epic link, Goal,
   Consumes/Produces (exact names and types), **Preconditions** (verifiable, with
   the stop-and-report rule), Steps with the **complete code copied from the plan**
   (a runner must never need the plan or another P-doc), run commands with expected
   output, commit step, Definition of Done checklist.
3. **Index map rows** in `{BACKLOG}/index.mdx`: one epic row + one `↳ P<N>` row
   each, status `🔵 Propuesto`, inserted additively (touch no other rows).
   Columns, exactly: `| Ítem | Área | Estado | Esfuerzo | Detalle |` — Detalle is
   `[<slug>](/backlog/<slug>/)`.

## Conversion rules (the judgment calls, pre-decided)

- **Language:** prose in **English**; status/effort tokens match the index legend
  (`🔵 Propuesto`, `Bajo/Medio/Alto`).
- **Dependencies:** derive each doc's true depends-on from the plan's
  **Interfaces** blocks (what it consumes), not from the coarse lane diagram —
  lanes often over-serialize (e.g. a component that only needs types from P2 can
  run parallel to P3/P4).
- **Runner rules** (copy into every epic): read epic + own doc first; verify
  Preconditions or STOP and report; integration branch named in the plan —
  sequential commits there, parallel runs branch `feat/<epic-short>-p<N>` and merge
  back; commands from the app dir, runner **bun** (`bun test`, `bunx tsc --noEmit`);
  pre-commit hook reformats staged files (normal); conventional commits with the
  co-author line; update status in the index map + own doc when done.
- **Statuses:** 🔵 Propuesto → 🟡 En progreso → 🟢 Hecho; epic goes
  🟢 Listo para validar when all P-docs are 🟢.

## Verification (before committing)

```bash
cd apps/documentation && bun run build   # all pages build, new docs included
```

Then check: every deliverable link in the epic table resolves to a created file;
no doc says "see the plan" for content (self-containment); index rows added and
nothing else in the map changed.

## Common mistakes

- Copying an exemplar's prose language instead of its **structure** — prose is
  English regardless of the exemplar's language.
- Summarizing plan code ("implement as in the plan") — runners see only their doc;
  paste the full code.
- Declaring lanes parallel because tasks are "conceptually separate" — only
  disjoint file sets justify parallelism.
- Rewriting `index.mdx` wholesale — insert rows additively; other epics' statuses
  are owned by their own work.
