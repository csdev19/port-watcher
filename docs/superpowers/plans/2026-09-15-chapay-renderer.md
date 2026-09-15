# chapay Renderer (functional UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A functional panel UI — port list with 2 s polling, instant filter input, keyboard navigation, kill flow with 2 s confirm + toast, and every panel state — with plain CSS and zero design work (the design pass comes later from the design brief).

**Architecture:** Pure logic lives in `src/lib/` (filter, formatters) and `src/hooks/` (polling, kill-confirm state machine, list navigation) — all unit-tested with Vitest. Components in `src/components/` stay thin. Every `invoke()` sits behind the `inTauri` guard in `src/lib/ports.ts` with mock data, so the whole UI runs in a plain browser tab.

**Tech Stack:** React 19, TypeScript, Vite, TanStack Query v5, Vitest + Testing Library (jsdom), CSS Modules.

**Spec:** `docs/specs/2026-09-15-chapay-mvp-spec.md`

## Global Constraints

- Everything committed is English, including UI copy.
- Voice (design brief): name the fact, never the feeling. "Vite (5173) stopped", not "Successfully killed!". No exclamation marks, no emoji. Never soften "kill".
- IPC contract (must match the Rust core plan verbatim): command `list_ports` → `PortEntry[]`; command `kill_port` with args `{ pid, port, startedAt }` → `KillResult`. `PortEntry` fields: `port, pid, processName, command, cwd, project, label, user, startedAt, memoryBytes, killable`. `KillResult`: `"terminated" | "killed" | "alreadyGone" | "permissionDenied"`.
- Event contract (menubar-shell plan emits it): `"panel-shown"` → refetch + focus search.
- Polling: 2000 ms via TanStack Query, `refetchIntervalInBackground: false` so a hidden panel does not poll.
- Versions come from the root catalog where an entry exists (`typescript`, `vite`, `@vitejs/plugin-react`, `vitest`, `jsdom`, `@testing-library/*`); `@tanstack/react-query` pinned to the same range the web app uses (`^5.90.12`).
- Run `bun run format` before each commit (lefthook enforces).

---

### Task 1: Deps, test harness, IPC types and mock data

**Files:**

- Modify: `apps/desktop/package.json`
- Modify: `apps/desktop/vite.config.ts` (teach Vite the `@` alias)
- Create: `apps/desktop/vitest.config.ts`
- Create: `apps/desktop/src/lib/types.ts`
- Create: `apps/desktop/src/lib/mock-ports.ts`
- Delete: `apps/desktop/src/App.css`, `apps/desktop/src/assets/react.svg`, `apps/desktop/public/vite.svg`, `apps/desktop/public/tauri.svg`

**Interfaces:**

- Consumes: the Rust core plan's serialization contract.
- Produces: `PortEntry`, `KillResult` TS types and `MOCK_PORTS: PortEntry[]` — every later task imports from `@/lib/types` and `@/lib/mock-ports`.

- [ ] **Step 1: Add dependencies and the test script**

In `apps/desktop/package.json`, add to `dependencies`:

```json
    "@tanstack/react-query": "^5.90.12",
```

to `devDependencies`:

```json
    "@testing-library/react": "catalog:",
    "jsdom": "catalog:",
    "vitest": "catalog:",
```

and to `scripts`:

```json
    "test": "vitest run",
    "test:watch": "vitest",
```

Then run `bun install` from the repo root.

- [ ] **Step 2: Teach Vite the `@` alias**

`tsconfig.json` already maps `@/*` to `./src/*`, but Vite resolves imports
itself. In `apps/desktop/vite.config.ts`, add the import and a `resolve` block
to the returned config object:

```typescript
import { fileURLToPath } from "node:url";
```

```typescript
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
```

(Placed at the same level as `plugins` and `server` inside `defineConfig(() => ({ ... }))`.)

- [ ] **Step 3: Create `apps/desktop/vitest.config.ts`**

```typescript
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // package.json is "type": "module", so no __dirname here.
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
```

- [ ] **Step 4: Create the types and mocks**

`apps/desktop/src/lib/types.ts` — mirrors `models.rs` in the Rust plan, field for field:

```typescript
/** Mirror of Rust `PortEntry` (serde camelCase). Do not add fields here
 * without adding them in src-tauri/src/ports/models.rs first. */
export interface PortEntry {
  port: number;
  pid: number;
  processName: string;
  command: string;
  cwd: string | null;
  project: string | null;
  label: string;
  user: string | null;
  /** Epoch seconds; doubles as the kill guard. */
  startedAt: number;
  memoryBytes: number;
  killable: boolean;
}

/** Mirror of Rust `KillResult`. */
export type KillResult = "terminated" | "killed" | "alreadyGone" | "permissionDenied";
```

`apps/desktop/src/lib/mock-ports.ts` — realistic rows for the browser loop, covering every UI branch (missing cwd, non-killable, long path):

```typescript
import type { PortEntry } from "./types";

const now = Math.floor(Date.now() / 1000);

export const MOCK_PORTS: PortEntry[] = [
  {
    port: 3000,
    pid: 4101,
    processName: "node",
    command: "node /Users/dev/tapuy/node_modules/.bin/next dev",
    cwd: "~/dev/tapuy/apps/web",
    project: "tapuy-web",
    label: "Next.js dev",
    user: "dev",
    startedAt: now - 12 * 60,
    memoryBytes: 210 * 1024 * 1024,
    killable: true,
  },
  {
    port: 5173,
    pid: 4102,
    processName: "node",
    command: "node /Users/dev/laqi/panel/node_modules/.bin/vite --host",
    cwd: "~/dev/laqi/panel-with-a-very-long-directory-name/apps/dashboard",
    project: "laqi-panel",
    label: "Vite",
    user: "dev",
    startedAt: now - 2 * 3600,
    memoryBytes: 95 * 1024 * 1024,
    killable: true,
  },
  {
    port: 5432,
    pid: 312,
    processName: "postgres",
    command: "/opt/homebrew/bin/postgres -D /opt/homebrew/var/postgresql@16",
    cwd: null,
    project: null,
    label: "PostgreSQL",
    user: "dev",
    startedAt: now - 3 * 86400,
    memoryBytes: 48 * 1024 * 1024,
    killable: true,
  },
  {
    port: 7000,
    pid: 88,
    processName: "ControlCenter",
    command: "/System/Library/CoreServices/ControlCenter.app/Contents/MacOS/ControlCenter",
    cwd: null,
    project: null,
    label: "ControlCenter",
    user: "root",
    startedAt: now - 5 * 86400,
    memoryBytes: 30 * 1024 * 1024,
    killable: false,
  },
  {
    port: 8787,
    pid: 4103,
    processName: "workerd",
    command: "/Users/dev/niway/api/node_modules/.bin/workerd serve",
    cwd: "~/dev/niway/api",
    project: "niway-api",
    label: "Wrangler (Workers)",
    user: "dev",
    startedAt: now - 40 * 60,
    memoryBytes: 130 * 1024 * 1024,
    killable: true,
  },
];
```

Delete the scaffold leftovers: `src/App.css`, `src/assets/react.svg`, `public/vite.svg`, `public/tauri.svg`. (App.tsx still imports them — it is rewritten in Task 6; until then `bun run --cwd apps/desktop dev` may fail, which is fine mid-plan. Type-check only the new files for now.)

- [ ] **Step 5: Verify the harness runs**

Run: `cd apps/desktop && bunx vitest run`
Expected: "No test files found" exit 0 or trivial pass — harness works.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop
git commit -m "feat(desktop-ui): ipc types, mock ports and vitest harness"
```

---

### Task 2: The ports client — every `invoke()` behind one guard

**Files:**

- Create: `apps/desktop/src/lib/ports.ts`
- Test: `apps/desktop/src/lib/ports.test.ts`

**Interfaces:**

- Consumes: `PortEntry`, `KillResult`, `MOCK_PORTS` (Task 1).
- Produces: `inTauri: boolean`, `listPorts(): Promise<PortEntry[]>`, `killPort(entry: PortEntry): Promise<KillResult>`. The only file in the renderer that imports `@tauri-apps/api/core`.

- [ ] **Step 1: Write the failing test**

`apps/desktop/src/lib/ports.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { inTauri, killPort, listPorts } from "./ports";
import { MOCK_PORTS } from "./mock-ports";

// jsdom has no __TAURI_INTERNALS__, so these tests exercise exactly what a
// plain browser tab gets: the mock path.
describe("ports client outside tauri", () => {
  it("detects it is not inside tauri", () => {
    expect(inTauri).toBe(false);
  });

  it("lists the mock ports", async () => {
    await expect(listPorts()).resolves.toEqual(MOCK_PORTS);
  });

  it("mock kill resolves terminated for killable rows", async () => {
    await expect(killPort(MOCK_PORTS[0])).resolves.toBe("terminated");
  });

  it("mock kill resolves permissionDenied for non-killable rows", async () => {
    const locked = MOCK_PORTS.find((p) => !p.killable)!;
    await expect(killPort(locked)).resolves.toBe("permissionDenied");
  });
});
```

- [ ] **Step 2: Run it — expect failure**

Run: `cd apps/desktop && bunx vitest run src/lib/ports.test.ts`
Expected: FAIL — `./ports` not found.

- [ ] **Step 3: Implement `apps/desktop/src/lib/ports.ts`**

```typescript
import { invoke } from "@tauri-apps/api/core";
import { MOCK_PORTS } from "./mock-ports";
import type { KillResult, PortEntry } from "./types";

/** True inside the real Tauri webview; false in the browser dev loop. */
export const inTauri = "__TAURI_INTERNALS__" in window;

export async function listPorts(): Promise<PortEntry[]> {
  if (!inTauri) return MOCK_PORTS;
  return invoke<PortEntry[]>("list_ports");
}

/** Passes startedAt back so the Rust side can refuse a recycled PID. */
export async function killPort(entry: PortEntry): Promise<KillResult> {
  if (!inTauri) {
    return entry.killable ? "terminated" : "permissionDenied";
  }
  return invoke<KillResult>("kill_port", {
    pid: entry.pid,
    port: entry.port,
    startedAt: entry.startedAt,
  });
}
```

- [ ] **Step 4: Run the tests**

Run: `cd apps/desktop && bunx vitest run src/lib/ports.test.ts`
Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/lib
git commit -m "feat(desktop-ui): ports client with inTauri guard and mocks"
```

---

### Task 3: Filter logic

**Files:**

- Create: `apps/desktop/src/lib/filter.ts`
- Test: `apps/desktop/src/lib/filter.test.ts`

**Interfaces:**

- Consumes: `PortEntry` (Task 1).
- Produces: `filterPorts(entries: PortEntry[], query: string): PortEntry[]`. Task 6 wires it to the search input.

- [ ] **Step 1: Write the failing tests**

`apps/desktop/src/lib/filter.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { filterPorts } from "./filter";
import { MOCK_PORTS } from "./mock-ports";

describe("filterPorts", () => {
  it("empty query returns everything", () => {
    expect(filterPorts(MOCK_PORTS, "")).toEqual(MOCK_PORTS);
    expect(filterPorts(MOCK_PORTS, "   ")).toEqual(MOCK_PORTS);
  });

  it("numeric query matches port by prefix", () => {
    const out = filterPorts(MOCK_PORTS, "51");
    expect(out.map((p) => p.port)).toEqual([5173]);
  });

  it("exact port match works", () => {
    expect(filterPorts(MOCK_PORTS, "3000").map((p) => p.port)).toEqual([3000]);
  });

  it("matches label case-insensitively", () => {
    expect(filterPorts(MOCK_PORTS, "postgre").map((p) => p.port)).toEqual([5432]);
    expect(filterPorts(MOCK_PORTS, "VITE").map((p) => p.port)).toEqual([5173]);
  });

  it("matches project and cwd", () => {
    expect(filterPorts(MOCK_PORTS, "niway").map((p) => p.port)).toEqual([8787]);
    expect(filterPorts(MOCK_PORTS, "laqi/panel").map((p) => p.port)).toEqual([5173]);
  });

  it("matches process name", () => {
    expect(filterPorts(MOCK_PORTS, "workerd").map((p) => p.port)).toEqual([8787]);
  });

  it("no match returns empty", () => {
    expect(filterPorts(MOCK_PORTS, "zzz-nothing")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`./filter` not found)

Run: `cd apps/desktop && bunx vitest run src/lib/filter.test.ts`

- [ ] **Step 3: Implement `apps/desktop/src/lib/filter.ts`**

```typescript
import type { PortEntry } from "./types";

/**
 * One query, three fields (spec §4.5): a numeric query prefixes the port;
 * any query substring-matches label, project, cwd and process name,
 * case-insensitively.
 */
export function filterPorts(entries: PortEntry[], query: string): PortEntry[] {
  const q = query.trim().toLowerCase();
  if (q === "") return entries;

  const isNumeric = /^\d+$/.test(q);
  return entries.filter((e) => {
    if (isNumeric && String(e.port).startsWith(q)) return true;
    const haystack = [e.label, e.project ?? "", e.cwd ?? "", e.processName]
      .join("\n")
      .toLowerCase();
    return haystack.includes(q);
  });
}
```

- [ ] **Step 4: Run — expect 7 PASS, then commit**

```bash
git add apps/desktop/src/lib
git commit -m "feat(desktop-ui): port filter across port, label, project and cwd"
```

---

### Task 4: Formatters — uptime, memory, middle truncation

**Files:**

- Create: `apps/desktop/src/lib/format.ts`
- Test: `apps/desktop/src/lib/format.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `formatUptime(startedAtSecs: number, nowMs?: number): string`, `formatMemory(bytes: number): string`, `middleTruncate(text: string, max: number): string`. Task 6 uses all three in `PortRow`.

- [ ] **Step 1: Write the failing tests**

`apps/desktop/src/lib/format.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { formatMemory, formatUptime, middleTruncate } from "./format";

const NOW = 1_800_000_000_000; // fixed ms clock for determinism

describe("formatUptime", () => {
  const started = (secsAgo: number) => NOW / 1000 - secsAgo;
  it("seconds under a minute", () => {
    expect(formatUptime(started(45), NOW)).toBe("45s");
  });
  it("minutes under an hour", () => {
    expect(formatUptime(started(12 * 60), NOW)).toBe("12m");
  });
  it("hours under a day", () => {
    expect(formatUptime(started(2 * 3600 + 40 * 60), NOW)).toBe("2h");
  });
  it("days from then on", () => {
    expect(formatUptime(started(3 * 86400), NOW)).toBe("3d");
  });
  it("unknown start (0) renders em dash", () => {
    expect(formatUptime(0, NOW)).toBe("—");
  });
});

describe("formatMemory", () => {
  it("MB below 1 GB", () => {
    expect(formatMemory(210 * 1024 * 1024)).toBe("210 MB");
  });
  it("GB with one decimal above 1 GB", () => {
    expect(formatMemory(1.5 * 1024 * 1024 * 1024)).toBe("1.5 GB");
  });
  it("zero renders em dash", () => {
    expect(formatMemory(0)).toBe("—");
  });
});

describe("middleTruncate", () => {
  it("short strings pass through", () => {
    expect(middleTruncate("~/dev/api", 30)).toBe("~/dev/api");
  });
  it("long paths keep both ends (the end identifies the project)", () => {
    const out = middleTruncate("~/dev/laqi/panel-long-name/apps/dashboard", 24);
    expect(out.length).toBeLessThanOrEqual(24);
    expect(out).toContain("…");
    expect(out.startsWith("~/dev")).toBe(true);
    expect(out.endsWith("dashboard")).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**, then implement `apps/desktop/src/lib/format.ts`:

```typescript
/** Coarse uptime, one unit only — this is a scan column, not a stopwatch. */
export function formatUptime(startedAtSecs: number, nowMs: number = Date.now()): string {
  if (startedAtSecs <= 0) return "—";
  const secs = Math.max(0, Math.floor(nowMs / 1000 - startedAtSecs));
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`;
  return `${Math.floor(secs / 86400)}d`;
}

export function formatMemory(bytes: number): string {
  if (bytes <= 0) return "—";
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}

/** Design brief: paths truncate in the middle — the end identifies them. */
export function middleTruncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const keep = max - 1;
  const head = Math.ceil(keep * 0.4);
  const tail = keep - head;
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`;
}
```

- [ ] **Step 3: Run — expect 10 PASS, then commit**

```bash
git add apps/desktop/src/lib
git commit -m "feat(desktop-ui): uptime, memory and middle-truncation formatters"
```

---

### Task 5: Hooks — polling, kill-confirm state machine, list navigation

**Files:**

- Create: `apps/desktop/src/hooks/use-ports.ts`
- Create: `apps/desktop/src/hooks/use-kill-confirm.ts`
- Create: `apps/desktop/src/hooks/use-list-navigation.ts`
- Test: `apps/desktop/src/hooks/use-kill-confirm.test.tsx`
- Test: `apps/desktop/src/hooks/use-list-navigation.test.tsx`

**Interfaces:**

- Consumes: `listPorts` (Task 2).
- Produces:
  - `usePorts()` → TanStack Query result for `["ports"]`, 2 s polling.
  - `useKillConfirm(onConfirm: () => void)` → `{ armed: boolean; trigger: () => void; disarm: () => void }` — first `trigger()` arms for 2 s ("Kill?"), second within the window fires `onConfirm`.
  - `useListNavigation(count: number)` → `{ selected: number; setSelected: (i: number) => void; onKeyDown: (e: KeyboardEvent) => "expand" | "kill" | "close" | null }`.

- [ ] **Step 1: Write the failing kill-confirm tests**

`apps/desktop/src/hooks/use-kill-confirm.test.tsx`:

```tsx
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useKillConfirm } from "./use-kill-confirm";

describe("useKillConfirm", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("first trigger arms, second confirms", () => {
    const onConfirm = vi.fn();
    const { result } = renderHook(() => useKillConfirm(onConfirm));
    act(() => result.current.trigger());
    expect(result.current.armed).toBe(true);
    expect(onConfirm).not.toHaveBeenCalled();
    act(() => result.current.trigger());
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(result.current.armed).toBe(false);
  });

  it("disarms itself after 2 seconds", () => {
    const onConfirm = vi.fn();
    const { result } = renderHook(() => useKillConfirm(onConfirm));
    act(() => result.current.trigger());
    act(() => vi.advanceTimersByTime(2000));
    expect(result.current.armed).toBe(false);
    // A trigger after the window re-arms instead of confirming
    act(() => result.current.trigger());
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**, then implement the three hooks.

`apps/desktop/src/hooks/use-kill-confirm.ts`:

```typescript
import { useCallback, useEffect, useRef, useState } from "react";

const CONFIRM_WINDOW_MS = 2000;

/** Spec §5: ✕ becomes "Kill?" for 2 s; the second click confirms. */
export function useKillConfirm(onConfirm: () => void) {
  const [armed, setArmed] = useState(false);
  // React 19: useRef requires an initial value.
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const disarm = useCallback(() => {
    clearTimeout(timer.current);
    setArmed(false);
  }, []);

  const trigger = useCallback(() => {
    if (armed) {
      disarm();
      onConfirm();
      return;
    }
    setArmed(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setArmed(false), CONFIRM_WINDOW_MS);
  }, [armed, disarm, onConfirm]);

  useEffect(() => () => clearTimeout(timer.current), []);

  return { armed, trigger, disarm };
}
```

`apps/desktop/src/hooks/use-ports.ts`:

```typescript
import { useQuery } from "@tanstack/react-query";
import { listPorts } from "@/lib/ports";

const POLL_MS = 2000;

/** 2 s polling while the panel is visible; zero polling in background
 * (spec §4.2 — the hidden window reports document.hidden). */
export function usePorts() {
  return useQuery({
    queryKey: ["ports"],
    queryFn: listPorts,
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
  });
}
```

`apps/desktop/src/hooks/use-list-navigation.ts`:

```typescript
import { useCallback, useState } from "react";

export type NavAction = "expand" | "kill" | "close" | null;

/** ↑↓ move, Enter expand, ⌘⌫ kill, Esc close (spec §5 keyboard). Works
 * while the search input keeps focus. */
export function useListNavigation(count: number) {
  const [selected, setSelected] = useState(0);

  const clamp = useCallback(
    (i: number) => (count === 0 ? 0 : Math.min(Math.max(i, 0), count - 1)),
    [count],
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent): NavAction => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelected((i) => clamp(i + 1));
          return null;
        case "ArrowUp":
          e.preventDefault();
          setSelected((i) => clamp(i - 1));
          return null;
        case "Enter":
          e.preventDefault();
          return "expand";
        case "Backspace":
          if (e.metaKey) {
            e.preventDefault();
            return "kill";
          }
          return null;
        case "Escape":
          return "close";
        default:
          return null;
      }
    },
    [clamp],
  );

  return { selected, setSelected: (i: number) => setSelected(clamp(i)), onKeyDown };
}
```

- [ ] **Step 3: Write the failing navigation tests**

`apps/desktop/src/hooks/use-list-navigation.test.tsx`:

```tsx
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useListNavigation } from "./use-list-navigation";

const key = (k: string, meta = false) =>
  new KeyboardEvent("keydown", { key: k, metaKey: meta, cancelable: true });

describe("useListNavigation", () => {
  it("arrows move and clamp at both ends", () => {
    const { result } = renderHook(() => useListNavigation(3));
    act(() => void result.current.onKeyDown(key("ArrowUp")));
    expect(result.current.selected).toBe(0); // clamped at top
    act(() => void result.current.onKeyDown(key("ArrowDown")));
    act(() => void result.current.onKeyDown(key("ArrowDown")));
    act(() => void result.current.onKeyDown(key("ArrowDown")));
    expect(result.current.selected).toBe(2); // clamped at bottom
  });

  it("maps enter, cmd+backspace and escape to actions", () => {
    const { result } = renderHook(() => useListNavigation(3));
    expect(result.current.onKeyDown(key("Enter"))).toBe("expand");
    expect(result.current.onKeyDown(key("Backspace", true))).toBe("kill");
    expect(result.current.onKeyDown(key("Backspace"))).toBe(null);
    expect(result.current.onKeyDown(key("Escape"))).toBe("close");
  });

  it("empty list keeps selection at 0", () => {
    const { result } = renderHook(() => useListNavigation(0));
    act(() => void result.current.onKeyDown(key("ArrowDown")));
    expect(result.current.selected).toBe(0);
  });
});
```

- [ ] **Step 4: Run all hook tests**

Run: `cd apps/desktop && bunx vitest run src/hooks`
Expected: 5 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/hooks
git commit -m "feat(desktop-ui): polling, kill-confirm and list-navigation hooks"
```

---

### Task 6: Components + App assembly

**Files:**

- Create: `apps/desktop/src/components/SearchInput.tsx`
- Create: `apps/desktop/src/components/PortRow.tsx`
- Create: `apps/desktop/src/components/PortList.tsx`
- Create: `apps/desktop/src/components/PanelStates.tsx`
- Create: `apps/desktop/src/components/Toast.tsx`
- Create: `apps/desktop/src/app.module.css`
- Modify: `apps/desktop/src/App.tsx` (full rewrite)
- Modify: `apps/desktop/src/main.tsx` (QueryClientProvider)
- Modify: `apps/desktop/src-tauri/capabilities/default.json` (allow window.hide)
- Test: `apps/desktop/src/components/PortRow.test.tsx`

**Interfaces:**

- Consumes: everything from Tasks 1–5; `getCurrentWindow().hide()` from `@tauri-apps/api/window`; event `"panel-shown"` from `@tauri-apps/api/event`.
- Produces: the assembled panel. The menubar-shell plan's `emit("panel-shown")` lands in the listener wired here.

- [ ] **Step 1: Write the failing PortRow test**

`apps/desktop/src/components/PortRow.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MOCK_PORTS } from "@/lib/mock-ports";
import { PortRow } from "./PortRow";

const noop = () => {};

describe("PortRow", () => {
  it("renders port, label and project", () => {
    render(
      <PortRow entry={MOCK_PORTS[0]} selected={false} expanded={false} onSelect={noop} onToggleExpand={noop} onKill={noop} />,
    );
    expect(screen.getByText("3000")).toBeTruthy();
    expect(screen.getByText("Next.js dev")).toBeTruthy();
    expect(screen.getByText(/tapuy/)).toBeTruthy();
  });

  it("kill needs two clicks: arm then confirm", () => {
    const onKill = vi.fn();
    render(
      <PortRow entry={MOCK_PORTS[0]} selected={true} expanded={false} onSelect={noop} onToggleExpand={noop} onKill={onKill} />,
    );
    const btn = screen.getByRole("button", { name: /kill/i });
    fireEvent.click(btn);
    expect(onKill).not.toHaveBeenCalled();
    expect(screen.getByText("Kill?")).toBeTruthy();
    fireEvent.click(screen.getByText("Kill?"));
    expect(onKill).toHaveBeenCalledTimes(1);
  });

  it("non-killable row shows a lock and no kill button", () => {
    const locked = MOCK_PORTS.find((p) => !p.killable)!;
    render(
      <PortRow entry={locked} selected={false} expanded={false} onSelect={noop} onToggleExpand={noop} onKill={noop} />,
    );
    expect(screen.queryByRole("button", { name: /kill/i })).toBeNull();
    expect(screen.getByTitle("Belongs to another user")).toBeTruthy();
  });

  it("expanded shows pid, memory and full command", () => {
    render(
      <PortRow entry={MOCK_PORTS[0]} selected={false} expanded={true} onSelect={noop} onToggleExpand={noop} onKill={noop} />,
    );
    expect(screen.getByText(/4101/)).toBeTruthy();
    expect(screen.getByText(/210 MB/)).toBeTruthy();
    expect(screen.getByText(/next dev/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**, then implement the components.

`apps/desktop/src/components/PortRow.tsx`:

```tsx
import type { PortEntry } from "@/lib/types";
import { formatMemory, formatUptime, middleTruncate } from "@/lib/format";
import { useKillConfirm } from "@/hooks/use-kill-confirm";
import styles from "@/app.module.css";

interface Props {
  entry: PortEntry;
  selected: boolean;
  expanded: boolean;
  onSelect: () => void;
  onToggleExpand: () => void;
  onKill: () => void;
}

export function PortRow({ entry, selected, expanded, onSelect, onToggleExpand, onKill }: Props) {
  const confirm = useKillConfirm(onKill);

  return (
    <li
      className={selected ? `${styles.row} ${styles.rowSelected}` : styles.row}
      onMouseEnter={onSelect}
      onClick={onToggleExpand}
      title={entry.command}
      aria-selected={selected}
    >
      <div className={styles.rowMain}>
        <span className={styles.port}>{entry.port}</span>
        <div className={styles.rowCenter}>
          <span className={styles.label}>{entry.label}</span>
          <span className={styles.meta}>
            {entry.cwd ? middleTruncate(entry.cwd, 34) : (entry.project ?? entry.processName)}
          </span>
        </div>
        <span className={styles.uptime}>{formatUptime(entry.startedAt)}</span>
        {entry.killable ? (
          <button
            type="button"
            className={confirm.armed ? styles.killArmed : styles.kill}
            aria-label={`Kill ${entry.label} on port ${entry.port}`}
            onClick={(e) => {
              e.stopPropagation();
              confirm.trigger();
            }}
            onMouseLeave={confirm.disarm}
          >
            {confirm.armed ? "Kill?" : "✕"}
          </button>
        ) : (
          <span className={styles.lock} title="Belongs to another user">
            🔒
          </span>
        )}
      </div>
      {expanded && (
        <dl className={styles.detail} onClick={(e) => e.stopPropagation()}>
          <dt>PID</dt>
          <dd>{entry.pid}</dd>
          <dt>User</dt>
          <dd>{entry.user ?? "—"}</dd>
          <dt>Memory</dt>
          <dd>{formatMemory(entry.memoryBytes)}</dd>
          <dt>Command</dt>
          <dd className={styles.command}>{entry.command}</dd>
        </dl>
      )}
    </li>
  );
}
```

`apps/desktop/src/components/SearchInput.tsx`:

```tsx
import { forwardRef } from "react";
import styles from "@/app.module.css";

interface Props {
  value: string;
  onChange: (value: string) => void;
}

/** Autofocused on mount and re-focused on every panel-shown event —
 * typing a port must work the instant the panel opens (spec §4.5). */
export const SearchInput = forwardRef<HTMLInputElement, Props>(function SearchInput(
  { value, onChange },
  ref,
) {
  return (
    <input
      ref={ref}
      className={styles.search}
      type="search"
      autoFocus
      placeholder="Search port, app or folder"
      value={value}
      onChange={(e) => onChange(e.currentTarget.value)}
      aria-label="Search port, app or folder"
    />
  );
});
```

`apps/desktop/src/components/PortList.tsx`:

```tsx
import type { PortEntry } from "@/lib/types";
import { PortRow } from "./PortRow";
import styles from "@/app.module.css";

interface Props {
  entries: PortEntry[];
  selected: number;
  expandedPid: number | null;
  onSelect: (index: number) => void;
  onToggleExpand: (pid: number) => void;
  onKill: (entry: PortEntry) => void;
}

export function PortList({ entries, selected, expandedPid, onSelect, onToggleExpand, onKill }: Props) {
  return (
    <ul className={styles.list} role="listbox" aria-label="Listening ports">
      {entries.map((entry, i) => (
        <PortRow
          key={`${entry.pid}:${entry.port}`}
          entry={entry}
          selected={i === selected}
          expanded={expandedPid === entry.pid}
          onSelect={() => onSelect(i)}
          onToggleExpand={() => onToggleExpand(entry.pid)}
          onKill={() => onKill(entry)}
        />
      ))}
    </ul>
  );
}
```

`apps/desktop/src/components/PanelStates.tsx`:

```tsx
import styles from "@/app.module.css";

export function EmptyState() {
  return <p className={styles.state}>All ports free</p>;
}

export function FilteredEmptyState({ onClear }: { onClear: () => void }) {
  return (
    <div className={styles.state}>
      <p>No match</p>
      <button type="button" onClick={onClear}>
        Clear search
      </button>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className={styles.state}>
      <p>{message}</p>
      <button type="button" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}
```

`apps/desktop/src/components/Toast.tsx`:

```tsx
import styles from "@/app.module.css";

export interface ToastData {
  message: string;
  command: string | null;
}

/** Design brief: the toast is the undo — it names what died and offers
 * the command to bring it back. */
export function Toast({ toast, onCopy }: { toast: ToastData; onCopy: () => void }) {
  return (
    <div className={styles.toast} role="status">
      <span>{toast.message}</span>
      {toast.command && (
        <button type="button" onClick={onCopy}>
          Copy command
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Rewrite `App.tsx` and `main.tsx`**

`apps/desktop/src/App.tsx`:

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePorts } from "@/hooks/use-ports";
import { useListNavigation } from "@/hooks/use-list-navigation";
import { filterPorts } from "@/lib/filter";
import { inTauri, killPort } from "@/lib/ports";
import type { PortEntry } from "@/lib/types";
import { PortList } from "@/components/PortList";
import { SearchInput } from "@/components/SearchInput";
import { EmptyState, ErrorState, FilteredEmptyState } from "@/components/PanelStates";
import { Toast, type ToastData } from "@/components/Toast";
import styles from "@/app.module.css";

async function hidePanel() {
  if (!inTauri) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().hide();
}

export default function App() {
  const queryClient = useQueryClient();
  const { data, error, refetch, dataUpdatedAt } = usePorts();
  const [query, setQuery] = useState("");
  const [expandedPid, setExpandedPid] = useState<number | null>(null);
  const [toast, setToast] = useState<ToastData | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const entries = useMemo(() => filterPorts(data ?? [], query), [data, query]);
  const nav = useListNavigation(entries.length);

  async function handleKill(entry: PortEntry) {
    const result = await killPort(entry);
    if (result === "terminated" || result === "killed") {
      setToast({ message: `${entry.label} (${entry.port}) stopped`, command: entry.command });
      queryClient.invalidateQueries({ queryKey: ["ports"] });
    } else if (result === "alreadyGone") {
      setToast({ message: `${entry.label} (${entry.port}) was already gone`, command: null });
      queryClient.invalidateQueries({ queryKey: ["ports"] });
    } else {
      setToast({ message: `Cannot kill ${entry.label} (${entry.port})`, command: null });
    }
  }

  // Keyboard drives the list even while the search input owns focus.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const action = nav.onKeyDown(e);
      const current = entries[nav.selected];
      if (action === "expand" && current) {
        setExpandedPid((p) => (p === current.pid ? null : current.pid));
      } else if (action === "kill" && current?.killable) {
        void handleKill(current);
      } else if (action === "close") {
        void hidePanel();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Shell emits panel-shown on every open: instant refetch + focus.
  useEffect(() => {
    if (!inTauri) return;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/event").then(async ({ listen }) => {
      unlisten = await listen("panel-shown", () => {
        void refetch();
        searchRef.current?.focus();
        searchRef.current?.select();
      });
    });
    return () => unlisten?.();
  }, [refetch]);

  // Toasts self-dismiss; keeping one visible while it has a copy action.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const updatedSecondsAgo = Math.max(0, Math.round((Date.now() - dataUpdatedAt) / 1000));

  return (
    <main className={styles.panel}>
      <SearchInput ref={searchRef} value={query} onChange={setQuery} />
      {error ? (
        <ErrorState message={String(error)} onRetry={() => void refetch()} />
      ) : entries.length > 0 ? (
        <PortList
          entries={entries}
          selected={nav.selected}
          expandedPid={expandedPid}
          onSelect={nav.setSelected}
          onToggleExpand={(pid) => setExpandedPid((p) => (p === pid ? null : pid))}
          onKill={(entry) => void handleKill(entry)}
        />
      ) : query.trim() !== "" ? (
        <FilteredEmptyState onClear={() => setQuery("")} />
      ) : (
        <EmptyState />
      )}
      <footer className={styles.footer}>
        {data ? `${entries.length} ports · updated ${updatedSecondsAgo}s ago` : "loading…"}
      </footer>
      {toast && (
        <Toast
          toast={toast}
          onCopy={() => {
            if (toast.command) void navigator.clipboard.writeText(toast.command);
            setToast(null);
          }}
        />
      )}
    </main>
  );
}
```

`apps/desktop/src/main.tsx`:

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
```

`apps/desktop/src/app.module.css` — functional only, the design pass replaces it:

```css
.panel {
  display: flex;
  flex-direction: column;
  height: 100vh;
  font-family: system-ui, sans-serif;
  font-size: 13px;
  background: #1a1a1c;
  color: #ededef;
}
.search {
  margin: 8px;
  padding: 6px 10px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  background: transparent;
  color: inherit;
}
.list {
  flex: 1;
  overflow-y: auto;
  margin: 0;
  padding: 0;
  list-style: none;
}
.row {
  padding: 6px 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  cursor: default;
}
.rowSelected {
  background: rgba(255, 255, 255, 0.07);
}
.rowMain {
  display: flex;
  align-items: center;
  gap: 10px;
}
.port {
  font-family: ui-monospace, monospace;
  font-size: 17px;
  font-variant-numeric: tabular-nums;
  min-width: 52px;
}
.rowCenter {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.label {
  font-weight: 500;
}
.meta {
  color: #8a8a93;
  font-size: 11px;
  white-space: nowrap;
}
.uptime {
  color: #8a8a93;
  font-variant-numeric: tabular-nums;
}
.kill,
.killArmed {
  border: none;
  background: transparent;
  color: #8a8a93;
  cursor: pointer;
  padding: 2px 6px;
}
.killArmed {
  color: #ff4d5e;
  font-weight: 600;
}
.lock {
  font-size: 11px;
}
.detail {
  margin: 6px 0 2px 62px;
  font-size: 11px;
  color: #8a8a93;
  display: grid;
  grid-template-columns: 60px 1fr;
  gap: 2px 8px;
}
.command {
  font-family: ui-monospace, monospace;
  word-break: break-all;
}
.state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: #8a8a93;
}
.footer {
  padding: 6px 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  color: #8a8a93;
  font-size: 11px;
}
.toast {
  position: fixed;
  bottom: 34px;
  left: 8px;
  right: 8px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 10px;
  border-radius: 6px;
  background: #2a2a2e;
}
```

- [ ] **Step 4: Allow `window.hide()` from JS**

`apps/desktop/src-tauri/capabilities/default.json` — capabilities are deny-by-default and `core:default` does NOT include hide:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Capability for the main window",
  "windows": ["main"],
  "permissions": ["core:default", "opener:default", "core:window:allow-hide"]
}
```

- [ ] **Step 5: Run everything**

Run: `cd apps/desktop && bunx vitest run && bunx tsc --noEmit`
Expected: all tests PASS (Row tests included), types clean.

- [ ] **Step 6: Verify in the browser loop**

Run: `bun run --cwd apps/desktop dev`, open http://localhost:1420
Expected: 5 mock rows; typing `51` leaves only Vite; `↑↓` move the highlight; clicking ✕ shows "Kill?"; second click removes nothing (mock) but shows the toast "Vite (5173) stopped" with Copy command; clearing a no-match query works from the filtered-empty state.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop
git commit -m "feat(desktop-ui): functional panel with list, search, keyboard and states"
```

---

### Task 7: Verify against the real Rust core

Requires the Rust core plan (Tasks 1–8) to be merged.

- [ ] **Step 1: Run the real app**

Run: `bun run dev:desktop`
Expected: the window shows this machine's actual listeners.

- [ ] **Step 2: Acceptance checklist (spec "done means")**

With `bun dev` running in at least one other project:

- [ ] The dev server's port appears with the right label and project folder
- [ ] Typing its port filters to it instantly
- [ ] ✕ → "Kill?" → click kills it; the toast names it; the row disappears on the next poll
- [ ] Re-running `list_ports` after the process died shows it gone
- [ ] A root-owned listener shows the lock, not ✕
- [ ] `⌘⌫` on a selected row kills without confirmation
- [ ] `Esc` hides the window (needs `core:window:allow-hide` — if it rejects, the capability didn't take; rebuild)

- [ ] **Step 3: Commit any fixes**

```bash
git add -A apps/desktop
git commit -m "fix(desktop-ui): adjustments from live verification"
```
