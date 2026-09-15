# Design tokens package (`@monorepo-template/tokens`) — design

> **Status: in progress** (2026-07-13). One typed TS source of truth for the
> design tokens, generating the CSS custom properties that feed web-ui's shadcn
> theme, and (later) a TS theme object for the React Native mobile app.
> Adapted from the `@kaipu/tokens` pattern; the template's extra platform is
> mobile (Expo/RN) instead of Electron.

## Problem

The template's theme lives only in `packages/web-ui/src/styles.css` as a shadcn
`oklch` variable block (light in `:root`, dark in `.dark`). It is web-only —
the mobile app (React Native, no CSS variables) can't share it, so values would
drift across platforms. There is no single, typed source of truth.

## Goal

One typed TS source that generates every consumed form of the tokens:

- **CSS** custom properties for the web, `--mt-*` prefixed so they never shadow
  shadcn's own `--background`/`--primary`/… variables. web-ui's shadcn theme
  maps its semantic vars to `var(--mt-…)`, so the tokens are the source of truth.
- **Typed TS objects** (`base`, `light`, `dark`) for JS/RN consumers.
- Dark + light themes (light is the template default, dark under `.dark`).

## Non-goals (this PR)

- **Wiring the package into the apps.** The package ships **standalone** — the
  web-ui shadcn mapping and the mobile `ThemeProvider` are _documented_ in the
  package README, not applied. Connecting is left to the consumer.
- The React Native theme object. RN can't render `oklch()`, so the mobile
  consumption path needs hex-derived values — a follow-up.
- A theme toggle / `system` mode (the template's existing theming is untouched).

## Architecture

```
packages/tokens/
  src/
    types.ts        # BASE_TOKEN_NAMES, THEME_TOKEN_NAMES, TokenSet (type-enforced parity)
    base.ts         # theme-invariant: radius, font-sans
    themes/light.ts # :root values (default)
    themes/dark.ts  # .dark values
    generate.ts     # TS -> CSS generator (~40 lines, zero deps), `--mt-` prefix
    index.ts        # exports base/light/dark/generateCss + types
    *.test.ts       # drift, generate, parity
  css/tokens.css    # GENERATED + COMMITTED (drift-guarded)
```

### Key decisions

1. **Value-preserving.** The tokens hold the template's _current_ shadcn `oklch`
   values verbatim, so the rendered web output is unchanged — this PR is a pure
   refactor of where the values live, not a re-theme.
2. **Tokens feed shadcn (documented).** The intended integration maps every
   shadcn semantic var to `var(--mt-…)` in `web-ui/styles.css`; because `--mt-*`
   switches under `.dark`, one `:root` mapping follows the active theme. This is
   written up in the package README as a copy-paste snippet, not applied here.
3. **Prefixed CSS.** `--mt-*` guarantees zero collision with shadcn's variables.
4. **Type-enforced parity.** `light` and `dark` are both `TokenSet`; a missing
   token is a compile error.
5. **Committed generated CSS, drift-guarded.** A vitest drift test runs the
   generator in memory and diffs against `css/tokens.css`; editing a TS token
   without running `bun run generate` fails CI.
6. **Test infrastructure.** The template had no test runner; this adds vitest, a
   `test` turbo task, a root `test` script, and a Test step in PR CI.

## Delivery — sequential PRs

| PR  | Scope                                                                    | Validation                   |
| --- | ------------------------------------------------------------------------ | ---------------------------- |
| PR1 | Package (standalone) + drift/generate/parity tests + connection README   | tests + full CI green        |
| PR2 | Connect web-ui to tokens (shadcn var mapping)                            | web renders unchanged        |
| PR3 | React Native theme object + Expo `ThemeProvider` wiring in `apps/mobile` | Visual check in the Expo app |

## Follow-up: i18n

A second, independent package (`@monorepo-template/i18n`, use-intl v4, es/en)
is planned as a separate spec + PRs, mirroring the `@kaipu/i18n` pattern.
