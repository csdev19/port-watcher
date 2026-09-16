import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { MOCK_PORTS } from "@/lib/mock-ports";

// These tests exercise the `panel-shown` lifecycle wiring in App.tsx,
// which only runs `inTauri`. `inTauri` is a module-level const computed
// from `window.__TAURI_INTERNALS__` at import time in src/lib/ports.ts,
// so it's simplest (and matches how the rest of the suite mocks the
// Tauri boundary) to mock `@/lib/ports` directly rather than fight
// module load order.
vi.mock("@/lib/ports", () => ({
  inTauri: true,
  listPorts: vi.fn(async () => MOCK_PORTS),
  killPort: vi.fn(async () => "terminated"),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ hide: vi.fn(async () => {}) }),
}));

// A controllable `listen`: each call returns a promise we resolve by
// hand, so tests can simulate the async-registration race the plan
// flags (unmount landing before `listen()` settles).
let pendingListenResolvers: Array<(unlisten: () => void) => void> = [];
const unlistenMocks: Array<ReturnType<typeof vi.fn>> = [];
const listenMock = vi.fn(
  (_event: string, _handler: (e: unknown) => void) =>
    new Promise<() => void>((resolve) => {
      pendingListenResolvers.push((unlisten) => resolve(unlisten));
    }),
);
let panelShownHandler: ((e: unknown) => void) | undefined;
vi.mock("@tauri-apps/api/event", () => ({
  listen: (event: string, handler: (e: unknown) => void) => {
    if (event === "panel-shown") panelShownHandler = handler;
    return listenMock(event, handler);
  },
}));

function resolveNextListen() {
  const resolver = pendingListenResolvers.shift();
  if (!resolver) throw new Error("no pending listen() call to resolve");
  const unlisten = vi.fn();
  unlistenMocks.push(unlisten);
  resolver(unlisten);
  return unlisten;
}

function renderApp() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  );
}

describe("App panel-shown lifecycle", () => {
  afterEach(() => {
    vi.clearAllMocks();
    pendingListenResolvers = [];
    unlistenMocks.length = 0;
    panelShownHandler = undefined;
  });

  it("registers a panel-shown listener and cleans it up on unmount once resolved", async () => {
    const { unmount } = renderApp();
    await waitFor(() =>
      expect(listenMock).toHaveBeenCalledWith("panel-shown", expect.any(Function)),
    );

    const unlisten = resolveNextListen();
    await waitFor(() => expect(unlisten).not.toHaveBeenCalled());

    unmount();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("disposes immediately (no leaked handler) when unmount happens before listen() resolves", async () => {
    const { unmount } = renderApp();
    await waitFor(() => expect(listenMock).toHaveBeenCalled());

    // Unmount before the async listen() promise settles.
    unmount();

    // Now the registration resolves — the disposed-flag path must
    // unlisten right away instead of storing a handler nobody cleans up.
    const unlisten = resolveNextListen();
    await waitFor(() => expect(unlisten).toHaveBeenCalledTimes(1));
  });

  it("panel-shown resets query, expansion, selection and confirmation, then refetches and focuses search", async () => {
    renderApp();
    await waitFor(() => expect(screen.getByText("3000")).toBeTruthy());
    resolveNextListen();

    const search = screen.getByLabelText("Search port, app or folder") as HTMLInputElement;
    fireEvent.change(search, { target: { value: "vite" } });
    expect(screen.getByText("5173")).toBeTruthy();

    // Arm a confirmation on the dev row so we can assert it gets
    // cleared too. Selection must match the armed row (pointer arming
    // is invalidated otherwise), so select it first.
    fireEvent.mouseEnter(screen.getByText("5173").closest("li")!);
    fireEvent.click(screen.getByLabelText("Kill Vite on port 5173"));
    expect(screen.getByText("Kill?")).toBeTruthy();

    expect(panelShownHandler).toBeTruthy();
    panelShownHandler!({});

    await waitFor(() => {
      // Query cleared -> every dev row visible again.
      expect(screen.getByText("3000")).toBeTruthy();
      expect(screen.getByText("5173")).toBeTruthy();
      expect(screen.getByText("5432")).toBeTruthy();
      expect(screen.getByText("8787")).toBeTruthy();
    });
    expect(search.value).toBe("");
    // Confirmation cleared: no armed "Kill?" label lingering.
    expect(screen.queryByText("Kill?")).toBeNull();
    expect(document.activeElement).toBe(search);
  });
});
