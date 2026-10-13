# @port-watcher/domain

Domain schemas, types and repository interfaces of the **monorepo template** that the web app was
cloned from. Today it holds only the Todo example. chapay's real domain (ports, kill guards,
categories) lives in the Rust core and in `apps/desktop/src/lib`; the desktop app does not import
this package. It is kept deliberately as a dormant template package.

## Purpose

This package is the leaf of the dependency rule (`domain <- application <- infra-*`): Zod schemas
that are the single source of truth for validation, the types derived from them, and the repository
interfaces that `application` depends on. It imports nothing from the other layers.

## Structure

```
packages/domain/
├── src/
│   ├── constants/        # placeholder; no domain constants yet
│   ├── repositories/     # ITodoRepository
│   ├── schemas/          # todo and pagination Zod schemas (+ __tests__)
│   ├── testing/          # test fixtures
│   └── types/            # Result, ApiResponse, ObjectProperties
├── dist/                 # built output (not committed)
├── package.json
├── tsconfig.json
├── tsdown.config.ts
└── vitest.config.ts
```

Each folder is a separate export: `@port-watcher/domain/constants`, `/repositories`, `/schemas`,
`/testing` and `/types`.

## Usage

### Importing schemas and types

```typescript
import { createTodoSchema, type CreateTodo } from "@port-watcher/domain/schemas";
```

### Importing Result and utility types

```typescript
import { tryCatch, type Result } from "@port-watcher/domain/types";
import type { ObjectProperties } from "@port-watcher/domain/types";
```

## Development

### Build

```bash
bun run build
```

### Watch Mode

```bash
bun run dev:watch
```

### Type Check

```bash
bun run check-types
```

## Constants Pattern

When domain constants are added, they follow the type-safe constants pattern. See the [Constants Pattern documentation](../../apps/documentation/src/content/docs/constants-pattern.mdx) for details.
