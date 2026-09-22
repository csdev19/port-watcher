# ADR 0002: shared panel presentation with a gated StyleX integration

**Status:** accepted for implementation planning; not implemented.
**Date:** 2026-09-16.
**Integration dependencies:** Phase 0 must verify the pinned StyleX compiler,
workspace token path, both Vite consumers, desktop test tooling, and fullstack
SSR/workerd output before the styling engine is accepted for implementation.

## Context

Desktop and the landing product shot duplicate panel markup and styles. The
existing tokens package does not yet encode the desktop panel palette. Shared
presentation is needed by two consumers, while native process actions and
persisted watched-port behavior remain desktop responsibilities.

Apply the dependency guidance in the
[architecture hub](https://github.com/csdev19/general-knowledge/blob/main/architecture/README.md)
without introducing new application/domain abstractions for visual reuse.

## Decision

- Introduce a source-exported `@port-watcher/panel-ui` presentation package,
  consumed first by the landing with fixtures, then by desktop with live data.
- Keep panel token values owned by `@port-watcher/tokens`. Gate the exact
  StyleX adapter and the bridge for remaining desktop CSS on compiler evidence;
  do not introduce a second hand-maintained palette.
- Provisionally use StyleX 0.17.x with Babel transformation and PostCSS CSS
  extraction in both apps. Preserve fullstack's existing Tailwind Vite plugin.
- Keep Tauri access, storage, data queries, confirmation, and interaction state
  in desktop. Resolve presentation input types before extraction rather than
  relocating the IPC contract into a UI package by assumption.
- Rename Favourites to Saved in a dedicated phase. New storage takes precedence;
  legacy storage is deleted only after a successful validated migration write.
  This prospectively updates ADR 0001's storage-key choice, not its port-only
  persistence model or confirmation ownership. Until implementation lands,
  `chapay.favourites` remains the current repository contract.

## Alternatives rejected

- Tokens alone: cannot remove markup drift between the two consumers.
- A screenshot: requires recapture and loses responsive shared presentation.
- Rewriting shadcn/Tailwind: unrelated to the duplicated panel and unnecessary.
- An unplugin-based integration: not selected initially; the explicit
  Babel/PostCSS path is the proposed spike, not a claim of proven compatibility.
- Plain CSS modules: retained as the fallback if the compiler/SSR gate fails.

## Consequences

Both apps must compile workspace sources and include the resulting CSS. Source
exports avoid a package `dist/` prerequisite but make compiler configuration,
HMR and test-runner compatibility explicit responsibilities. Native behavior
needs regression checks during extraction; shared markup does not guarantee
identical cascade, fonts, fixtures, or application state in both consumers.

## Explicit non-goals

No backend/IPC redesign, light theme, native behavior redesign, migration of
desktop-only forms to StyleX, shadcn rewrite, or repository/crate/scope rename.

## Reopen this decision when

The pinned compiler cannot consume the token contract without a reviewed
adapter, SSR/workerd or test tooling cannot support the integration, or shared
presentation would require desktop policy to move into the UI package. Stop
and review the relevant boundary; use CSS modules if the StyleX gate fails.

## Operational specification

Phase gates, ownership, migration failure handling and planning requirements
live in the [panel-ui spec](../superpowers/specs/2026-09-16-panel-ui-stylex-design.md).
Detailed execution documents must incorporate Phase 0 findings before downstream
tasks are treated as executable.
