# @port-watcher/web-ui

Shared UI component library for the port-watcher monorepo.

## Installation

This package is part of the monorepo workspace. Install dependencies:

```bash
bun install
```

## Development

Build the library:

```bash
bun run build
```

Watch mode for development:

```bash
bun run dev
```

The build process uses Vite to:

- Bundle and optimize components
- Generate TypeScript declarations
- Inject CSS automatically
- Create source maps

### Adding Components with shadcn/ui

This package uses shadcn/ui for component management. To add new components:

```bash
# From the package directory
cd packages/web-ui
npx shadcn@latest add button

# Or use --cwd flag from root
npx shadcn@latest add button --cwd packages/web-ui
```

Components will be added to `src/components/` and should be exported from `src/index.ts`.

## Usage

### Import Components

```tsx
import { Button, Card, TestComponent } from "@port-watcher/web-ui";
```

### Import Styles

```tsx
import "@port-watcher/web-ui/styles.css";
```

### Test Component

A simple test component is included to verify the setup:

```tsx
import { TestComponent } from "@port-watcher/web-ui";

function App() {
  return <TestComponent />;
}
```

## Components

- Button
- Card
- Checkbox
- DropdownMenu
- Input
- Label
- Skeleton
- Sonner (Toaster)
- Table
- Textarea
- TestComponent

## Build Output

- `dist/index.es.js` - Bundled ES module
- `dist/index.d.ts` - TypeScript declarations
- `dist/index.css` - Compiled Tailwind CSS
- Source maps are included for debugging
