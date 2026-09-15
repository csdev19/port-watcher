# @monorepo-template/i18n

Shared internationalization for the monorepo, built on
[use-intl](https://next-intl.dev/docs/environments/core) v4. Two locales
(`en` — default and source of truth — and `es`), one message catalog, a
persistence-agnostic React provider, plus web (cookie/SSR) and non-React
helpers.

This package ships **standalone** — nothing is wired into the apps yet. Connect
it with the snippets below.

## What's inside

```
messages/
  en.json          # source of truth
  es.json          # exact key mirror (enforced by the parity test)
src/
  config.ts        # SUPPORTED_LOCALES, DEFAULT_LOCALE='en', TIME_ZONE, normalizeLocale, isLocale
  app-config.ts    # declare module 'use-intl' → typed keys from en.json
  provider.tsx     # <I18nProvider> + useLocale + useSetLocale (persistence injected)
  web.ts           # detectLocaleWeb / persistLocaleWeb (cookie) / detectLocaleFromRequest (SSR)
  core.ts          # createAppTranslator(locale) — for server fns / non-React code
  index.ts         # re-exports use-intl hooks + provider + config + `messages`
```

Exports: `@monorepo-template/i18n` (provider, hooks, `messages`, config) ·
`./web` (cookie/SSR — server-safe) · `./core` (non-React translator) ·
`./messages/en` · `./messages/es`.

## Editing copy

`en.json` is the source; mirror every key in `es.json`. The parity test fails on
any missing/extra key or empty string:

```bash
bun run test
```

`useTranslations("nav")` autocompletes namespaces and validates keys against
`en.json` (via the `app-config.ts` augmentation — restart your TS server if the
types don't resolve at first).

## Connecting it (web — TanStack Start)

Add `"@monorepo-template/i18n": "workspace:*"` to the app, then wrap the app and
resolve the locale on the server so the first byte is already correct:

```tsx
import { I18nProvider, messages } from "@monorepo-template/i18n";
import { detectLocaleFromRequest, persistLocaleWeb } from "@monorepo-template/i18n/web";

// in the root route: resolve `locale` (SSR) via detectLocaleFromRequest(request)
<I18nProvider
  initialLocale={locale}
  messagesByLocale={messages}
  onLocaleChange={persistLocaleWeb}
>
  {children}
</I18nProvider>;
```

In components:

```tsx
import { useTranslations } from "@monorepo-template/i18n";
const t = useTranslations("common");
return <button>{t("save")}</button>;
```

A language switcher calls `useSetLocale()` — on web, follow it with a
`router.invalidate()` so the SSR-resolved locale re-runs.

## Connecting it (server functions / non-React)

```ts
import { createAppTranslator } from "@monorepo-template/i18n/core";
const t = createAppTranslator("es");
t("common.save"); // "Guardar"
```

## Defaults you may want to change

- **`DEFAULT_LOCALE`** (`config.ts`) — `en`. Set to `es` if that's your primary.
- **`TIME_ZONE`** (`config.ts`) — `UTC`. Set to your app's zone for correct
  date/number formatting.
- **`LOCALE_COOKIE`** (`web.ts`) — `LOCALE`.
