# desktop

A local-first Electron app: everything it stores lives on the device, and it makes
no network calls. It is the template's clearest demonstration of the dependency
rule — see [Why this app exists](#why-this-app-exists).

Built with [electron-vite](https://electron-vite.org) 5, Electron 44, React 19 and
CSS Modules, packaged by electron-builder 26.

## Commands

```bash
bun run dev            # start with HMR (from the repo root: bun run dev:desktop)
bun run test           # unit tests (main process) + component tests (renderer)
bun run check-types    # tsc for the node and web projects
bun run build          # type-check, then electron-vite build -> out/

bun run package:dev    # unpacked build, for a quick local smoke test
bun run package:mac    # signed (and notarized) macOS build — see Signing below
```

## Why this app exists

`packages/domain` declares the `ITodoRepository` port. `packages/infra-db`
implements it with Drizzle against Postgres, for the server. This app implements
the **same port** in `src/main/infrastructure/sqlite-todo.repository.ts`, against
on-device SQLite.

Because both are adapters of one port, the use cases in
`@monorepo-template/application` run unchanged on either side — `src/main/ipc/todos.ipc.ts`
calls the very same `createTodo` / `listTodos` / `updateTodo` / `deleteTodo` the
API Worker calls. `sqlite-todo.repository.test.ts` asserts exactly that.

The port scopes every operation by `userId`. A local-first app has no accounts, so
`src/main/local-user.ts` supplies a constant one. Keeping the port's shape rather
than forking it is what makes the use cases reusable, and it leaves room for real
sign-in later (see [Adding authentication](#adding-authentication)).

## Layout

```
src/
├── main/              # Node. Owns the window, the database and the tray.
│   ├── index.ts       #   composition root — everything is constructed here
│   ├── tray.ts        #   native menu, translated via i18n's non-React export
│   ├── infrastructure/#   settings store, SQLite connection, the repository
│   └── ipc/           #   driving adapters: validate input, call a use case
├── preload/           # The only bridge. contextIsolation stays on.
├── shared/types/      # The IPC contract, imported by main AND renderer
└── renderer/          # React. Never touches Node — only window.api.
```

## Shared packages

| Package       | Where           | How                                                               |
| ------------- | --------------- | ----------------------------------------------------------------- |
| `domain`      | main            | the `ITodoRepository` port, Zod schemas for IPC validation        |
| `application` | main            | the use cases, given the local adapter                            |
| `i18n`        | main + renderer | `core` for the tray; `I18nProvider` / `useTranslations` in the UI |
| `tokens`      | renderer        | `@import "@monorepo-template/tokens/css/desktop"` in `base.css`   |

Those four sit in **`devDependencies`, deliberately**. `externalizeDepsPlugin`
externalizes exactly what `dependencies` lists, and electron-builder packages
exactly that. Since these packages export raw TypeScript with no `dist`,
externalizing them would leave Node trying to `require` a `.ts` file at runtime.
As devDependencies they are bundled into `out/`, and their source stays out of the
shipped asar. Only genuine runtime deps (`electron-updater`, `zod`,
`@electron-toolkit/*`) belong in `dependencies`.

## Styling

The renderer imports the **unprefixed** token sheet (`--background`, not
`--mt-background`) — there is no shadcn here to collide with. Components use CSS
Modules; there is no Tailwind and no `web-ui` dependency, so the desktop and the
web apps share a palette without sharing a component library.

Dark mode needs no branching in React: the main process sets
`nativeTheme.themeSource` from the stored preference, Electron makes the
renderer's `prefers-color-scheme` follow it, and `app/theme.tsx` toggles the
`.dark` class from that one media query.

## Data

`node:sqlite` ships with Node 24, which Electron 44 bundles — so there is a real
SQL store with **no native module to rebuild per platform**. The database and the
settings file live under `app.getPath("userData")`.

The API is still flagged experimental upstream (it needs no CLI flag, but it can
change across Node majors), and the schema is created with `CREATE TABLE IF NOT
EXISTS`. Before your first schema change reaches users, move to versioned
migrations — a `user_version` pragma plus an ordered list of steps.

## Signing and release

`electron-builder.yml` ships with placeholders. Replace `appId`, `productName`
and `publish.url`, and keep `appId` identical to `APP_ID` in `src/main/index.ts` —
it namespaces the app's data directory and the Windows taskbar grouping.

**Locally:** copy `.env.signing.example` to `.env.signing`, fill it in, then run
`bun run package:mac`. electron-builder does not read `.env` files itself, which is
why `scripts/build-mac-local.sh` sources them first. With the `APPLE_API_*` vars
set the build is notarized and stapled; without them it is signed only.

**In CI:** `.github/workflows/release-desktop.yml` builds, signs and notarizes on a
`desktop-v*` tag and attaches the DMGs to a draft GitHub Release. It needs the
signing secrets in a `production` GitHub Environment — the workflow header lists
them. Publishing an update feed is off until you set `PUBLISH_UPDATES=true` and
add the bucket credentials.

Windows and Linux targets are declared in `electron-builder.yml` but no workflow
builds them; a matrix job is sketched, commented out, at the bottom of
`release-desktop.yml`. Their signing story is not validated here.

## Adding authentication

The app is designed to stay usable offline with no account, so sign-in should be
opt-in rather than a gate. The approach that fits an Electron client is Better
Auth's **`bearer` plugin** with the token in `safeStorage` — no cookie jar to
build, and no CORS to arrange. `LOCAL_USER_ID` becomes the real user id and the
repository does not change.
