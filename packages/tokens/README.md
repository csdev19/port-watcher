# @monorepo-template/tokens

One typed TS source of truth for the design tokens, generating the CSS custom
properties consumed by the web apps (and, once you connect it, a theme object
for React Native). Dark + light, `--mt-*` prefixed so they never collide with
shadcn's own variables.

This package ships **standalone** — nothing is wired into the apps yet. Connect
it where you need it using the snippets below.

## What's inside

```
src/
  types.ts        # BASE_TOKEN_NAMES, THEME_TOKEN_NAMES, TokenSet (type-enforced parity)
  base.ts         # theme-invariant tokens: radius, font-sans
  themes/light.ts # default (:root)
  themes/dark.ts  # applied under .dark
  generate.ts     # TS -> CSS generator (zero deps)
  index.ts        # exports base, light, dark, generateCss + types
css/tokens.css    # GENERATED + committed (run `bun run generate` after editing tokens)
```

Exports: `@monorepo-template/tokens` (TS objects) · `@monorepo-template/tokens/css`
(the stylesheet).

## Editing tokens

Edit `src/base.ts` or `src/themes/*.ts`, then regenerate the CSS:

```bash
bun run generate   # rewrites css/tokens.css
bun run test       # drift test fails if you forgot to regenerate
```

`light` and `dark` are both `TokenSet`, so a missing token is a compile error.

## Connecting it (web — feed shadcn)

Import the token CSS in your web-ui stylesheet and map shadcn's semantic
variables to the tokens. Because `--mt-*` already switches under `.dark`, the
mapping is declared once in `:root` and follows the active theme:

```css
/* packages/web-ui/src/styles.css */
@import "@monorepo-template/tokens/css";

:root {
  --background: var(--mt-background);
  --foreground: var(--mt-foreground);
  --primary: var(--mt-primary);
  --border: var(--mt-border);
  --radius: var(--mt-radius);
  /* …map the rest of shadcn's vars the same way */
}
```

Add `"@monorepo-template/tokens": "workspace:*"` to `web-ui`'s dependencies.

## Connecting it (React Native — later)

RN can't render `oklch()`, so the mobile theme needs hex-derived values. That
consumption path (a resolved `{ light, dark }` theme object + an Expo
`ThemeProvider`) is a follow-up. For now the raw typed objects are importable:

```ts
import { light, dark } from "@monorepo-template/tokens";
```
