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

  // F7 Slice 5, case 11: reopening the panel resets the active tab, query,
  // form and confirmation, keeps the saved favourites list intact, and
  // refetches exactly once through the existing panel-shown listener —
  // no second, parallel poll is started.
  it("panel-shown resets tab/query/form/confirmation, keeps favourites, and refetches once", async () => {
    window.localStorage.setItem("chapay.favourites", JSON.stringify([{ port: 3000 }]));
    renderApp();
    await waitFor(() => expect(screen.getByText("3000")).toBeTruthy());
    resolveNextListen();
    const listCallsBeforeSwitch = (await import("@/lib/ports")).listPorts as unknown as ReturnType<
      typeof vi.fn
    >;

    fireEvent.click(screen.getByRole("tab", { name: /favourites/i }));
    await waitFor(() => expect(screen.getByText("in use")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Search port, app or folder"), {
      target: { value: "next" },
    });
    fireEvent.click(screen.getByRole("button", { name: /watch a port/i }));
    expect(screen.getByLabelText("Port")).toBeTruthy();

    const callsBeforeReopen = listCallsBeforeSwitch.mock.calls.length;

    expect(panelShownHandler).toBeTruthy();
    panelShownHandler!({});

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /listening/i }).getAttribute("aria-selected")).toBe(
        "true",
      );
    });
    expect((screen.getByLabelText("Search port, app or folder") as HTMLInputElement).value).toBe(
      "",
    );
    // Switching back to Listening unmounts FavouritesPanel, discarding its
    // local form state — reopening Favourites shows the trigger, not a
    // form still open.
    fireEvent.click(screen.getByRole("tab", { name: /favourites/i }));
    expect(screen.getByRole("button", { name: /watch a port/i })).toBeTruthy();
    // The saved favourite survived the reset.
    expect(screen.getByText("in use")).toBeTruthy();

    // Exactly one refetch call was triggered by panel-shown.
    expect(listCallsBeforeSwitch.mock.calls.length).toBe(callsBeforeReopen + 1);
  });

  // Switching tabs (without a panel-shown reopen) must never itself start
  // an extra poll — the shared `usePorts` interval is the only polling
  // source for both tabs. This asserts the mocked `listPorts` call count
  // does not grow from tab switches alone, only from what the shared
  // 2s interval and explicit refetches already accounted for.
  it("switching tabs repeatedly does not create an extra polling source", async () => {
    renderApp();
    await waitFor(() => expect(screen.getByText("3000")).toBeTruthy());
    resolveNextListen();
    const { listPorts } = await import("@/lib/ports");
    const spy = listPorts as unknown as ReturnType<typeof vi.fn>;

    const callsBefore = spy.mock.calls.length;
    for (let i = 0; i < 6; i++) {
      fireEvent.click(
        screen.getByRole("tab", { name: i % 2 === 0 ? /favourites/i : /listening/i }),
      );
    }
    // No time has passed (no interval tick), and switching tabs calls no
    // fetch of its own — the call count must be unchanged.
    expect(spy.mock.calls.length).toBe(callsBefore);
  });
});
