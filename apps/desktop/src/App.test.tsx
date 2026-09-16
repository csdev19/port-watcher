import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { MOCK_PORTS } from "@/lib/mock-ports";
import * as portsModule from "@/lib/ports";

/** jsdom has no __TAURI_INTERNALS__, so `inTauri` is false and the app
 * renders MOCK_PORTS with zero Tauri mocking — this is the whole point
 * of the `inTauri` split. This test covers the composed flow that no
 * individual component test exercises: data load, search, kill confirm,
 * and clearing a filtered-empty state. */
function renderApp() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  );
}

function killShortcut() {
  fireEvent.keyDown(window, { key: "Backspace", metaKey: true, code: "Backspace" });
}

function repeatedKillShortcut() {
  fireEvent.keyDown(window, { key: "Backspace", metaKey: true, code: "Backspace", repeat: true });
}

/** Rows only listen for `mouseenter`, which does not bubble — dispatch
 * directly on the `<li>` to move selection, the same way App.tsx does. */
function hoverRow(port: number) {
  const li = screen.getByText(String(port)).closest("li")!;
  fireEvent.mouseEnter(li);
}

describe("App", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders all mock ports once the initial fetch resolves", async () => {
    renderApp();
    await waitFor(() => {
      for (const entry of MOCK_PORTS) {
        expect(screen.getByText(String(entry.port))).toBeTruthy();
      }
    });
  });

  it("narrows the list when searching", async () => {
    renderApp();
    await waitFor(() => expect(screen.getByText("5173")).toBeTruthy());

    const search = screen.getByLabelText("Search port, app or folder");
    fireEvent.change(search, { target: { value: "51" } });

    expect(screen.getByText("5173")).toBeTruthy();
    expect(screen.queryByText("3000")).toBeNull();
    expect(screen.queryByText("5432")).toBeNull();
    expect(screen.queryByText("7000")).toBeNull();
    expect(screen.queryByText("8787")).toBeNull();
  });

  it("pointer kill requires arm-then-confirm and shows a stopped toast", async () => {
    renderApp();
    await waitFor(() => expect(screen.getByText("3000")).toBeTruthy());

    const killBtn = screen.getByLabelText("Kill Next.js dev on port 3000");
    fireEvent.click(killBtn);
    expect(screen.getByText("Kill?")).toBeTruthy();

    fireEvent.click(screen.getByText("Kill?"));

    await waitFor(() => {
      const toast = screen.getByRole("status");
      expect(toast.textContent).toContain("stopped");
      expect(toast.textContent).toContain("3000");
    });
  });

  it("clears the search from the filtered-empty state", async () => {
    renderApp();
    await waitFor(() => expect(screen.getByText("3000")).toBeTruthy());

    const search = screen.getByLabelText("Search port, app or folder");
    fireEvent.change(search, { target: { value: "zzz-nothing" } });

    expect(screen.getByText("No port matches zzz-nothing")).toBeTruthy();
    fireEvent.click(screen.getByText("Clear search"));

    await waitFor(() => {
      for (const entry of MOCK_PORTS) {
        expect(screen.getByText(String(entry.port))).toBeTruthy();
      }
    });
  });

  it("⌘⌫ on a dev row kills immediately, no arming", async () => {
    const killSpy = vi.spyOn(portsModule, "killPort");
    renderApp();
    await waitFor(() => expect(screen.getByText("3000")).toBeTruthy());

    // The first entry (port 3000, dev) is selected by default.
    killShortcut();
    expect(killSpy).toHaveBeenCalledTimes(1);
    expect(killSpy).toHaveBeenCalledWith(expect.objectContaining({ port: 3000 }));

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("stopped");
    });
  });

  it("⌘⌫ on a protected (system) row requires a second shortcut within the window", async () => {
    const killSpy = vi.spyOn(portsModule, "killPort");
    renderApp();
    await waitFor(() => expect(screen.getByText("7000")).toBeTruthy());
    hoverRow(7000);

    killShortcut();
    expect(killSpy).not.toHaveBeenCalled();

    killShortcut();
    expect(killSpy).toHaveBeenCalledTimes(1);
    expect(killSpy).toHaveBeenCalledWith(expect.objectContaining({ port: 7000 }));
  });

  it("a held ⌘⌫ (repeated keydown) never arms then confirms itself", async () => {
    const killSpy = vi.spyOn(portsModule, "killPort");
    renderApp();
    await waitFor(() => expect(screen.getByText("7000")).toBeTruthy());
    hoverRow(7000);

    killShortcut();
    repeatedKillShortcut();
    repeatedKillShortcut();
    expect(killSpy).not.toHaveBeenCalled();

    killShortcut();
    expect(killSpy).toHaveBeenCalledTimes(1);
  });

  it("changing the selected row cancels an armed keyboard confirmation", async () => {
    const killSpy = vi.spyOn(portsModule, "killPort");
    renderApp();
    await waitFor(() => expect(screen.getByText("7000")).toBeTruthy());

    hoverRow(7000);
    killShortcut();
    expect(killSpy).not.toHaveBeenCalled();

    // Moving the selection away from the armed row disarms it.
    hoverRow(5173);
    // Moving back does not resurrect the old arm — this still has to
    // arm again rather than confirm.
    hoverRow(7000);
    killShortcut();
    expect(killSpy).not.toHaveBeenCalled();

    // A genuine second press now confirms the freshly re-armed target.
    killShortcut();
    expect(killSpy).toHaveBeenCalledTimes(1);
    expect(killSpy).toHaveBeenCalledWith(expect.objectContaining({ port: 7000 }));
  });

  it("a locked row never calls killPort, pointer or keyboard", async () => {
    const killSpy = vi.spyOn(portsModule, "killPort");
    renderApp();
    await waitFor(() => expect(screen.getByText("631")).toBeTruthy());
    hoverRow(631);

    killShortcut();
    killShortcut();
    expect(killSpy).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(/Kill cupsd/)).toBeNull();
  });
});
