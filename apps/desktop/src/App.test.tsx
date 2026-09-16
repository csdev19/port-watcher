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
function renderApp(options?: { retry?: boolean }) {
  const client = new QueryClient(
    options?.retry === false ? { defaultOptions: { queries: { retry: false } } } : undefined,
  );
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

/** Favourites' watch heading also renders the port number as text, so a
 * plain `getByText(port)` lookup is ambiguous there — resolve the row via
 * its kill button's (stale or not) accessible label instead. */
function hoverFavouriteRow(port: number) {
  const li = screen.getByLabelText(new RegExp(`^(Kill|Cannot kill).*port ${port}`)).closest("li")!;
  fireEvent.mouseEnter(li);
}

/** MOCK_PORTS' dev rows (3000, 5173, 5432, 8787) render by default; the
 * secondary group (7000 system/killable, 631 system/locked) starts
 * collapsed behind the Apps & System disclosure. */
function expandSecondary() {
  fireEvent.click(screen.getByRole("button", { name: /apps & system/i }));
}

describe("App", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("renders dev rows, with Apps & System collapsed by default", async () => {
    renderApp();
    await waitFor(() => {
      for (const entry of MOCK_PORTS.filter((e) => e.category === "dev")) {
        expect(screen.getByText(String(entry.port))).toBeTruthy();
      }
    });
    expect(screen.queryByText("7000")).toBeNull();
    expect(screen.queryByText("631")).toBeNull();
    expect(
      screen.getByRole("button", { name: /apps & system · 2/i }).getAttribute("aria-expanded"),
    ).toBe("false");
  });

  it("expands Apps & System manually and can collapse it again", async () => {
    renderApp();
    await waitFor(() => expect(screen.getByText("3000")).toBeTruthy());

    expandSecondary();
    expect(screen.getByText("7000")).toBeTruthy();
    expect(screen.getByText("631")).toBeTruthy();

    expandSecondary();
    expect(screen.queryByText("7000")).toBeNull();
  });

  it("arrow-down actually moves selection, clamping at the last visible dev row without spilling into the hidden secondary group", async () => {
    const killSpy = vi.spyOn(portsModule, "killPort");
    renderApp();
    await waitFor(() => expect(screen.getByText("3000")).toBeTruthy());

    // MOCK_PORTS' visible dev rows, in render order: 3000, 5173, 5432, 8787.
    // Row 3000 is selected by default; three ArrowDown presses should walk
    // selection down to the last dev row (8787).
    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: "ArrowDown" });
    killShortcut();
    expect(killSpy).toHaveBeenCalledTimes(1);
    expect(killSpy).toHaveBeenCalledWith(expect.objectContaining({ port: 8787 }));
    killSpy.mockClear();

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("stopped");
    });
  });

  it("arrow-down clamps at the last dev row and never spills into the collapsed secondary group", async () => {
    const killSpy = vi.spyOn(portsModule, "killPort");
    renderApp();
    await waitFor(() => expect(screen.getByText("3000")).toBeTruthy());

    // Three presses reach the last dev row (8787); three more presses must
    // clamp there rather than spilling into the collapsed secondary group
    // (7000/631, which are not keyboard-reachable while collapsed).
    for (let i = 0; i < 6; i++) {
      fireEvent.keyDown(window, { key: "ArrowDown" });
    }
    killShortcut();
    expect(killSpy).toHaveBeenCalledTimes(1);
    expect(killSpy).toHaveBeenCalledWith(expect.objectContaining({ port: 8787 }));
    expect(killSpy).not.toHaveBeenCalledWith(expect.objectContaining({ port: 7000 }));
  });

  it("a nonempty search with only secondary matches forces the section open and disables collapsing", async () => {
    renderApp();
    await waitFor(() => expect(screen.getByText("3000")).toBeTruthy());

    const search = screen.getByLabelText("Search port, app or folder");
    fireEvent.change(search, { target: { value: "control" } });

    expect(screen.getByText("7000")).toBeTruthy();
    const disclosure = screen.getByRole("button", { name: /expanded for search results/i });
    expect(disclosure.getAttribute("aria-expanded")).toBe("true");
    expect((disclosure as HTMLButtonElement).disabled).toBe(true);

    // Clearing the query restores the manual (collapsed) default.
    fireEvent.change(search, { target: { value: "" } });
    await waitFor(() => expect(screen.queryByText("7000")).toBeNull());
  });

  it("clearing search after manual expansion keeps it expanded", async () => {
    renderApp();
    await waitFor(() => expect(screen.getByText("3000")).toBeTruthy());
    expandSecondary();
    expect(screen.getByText("7000")).toBeTruthy();

    const search = screen.getByLabelText("Search port, app or folder");
    fireEvent.change(search, { target: { value: "zzz-nothing" } });
    fireEvent.change(search, { target: { value: "" } });

    await waitFor(() => expect(screen.getByText("7000")).toBeTruthy());
  });

  it("footer counts filtered listener rows and dev rows, not only expanded ones", async () => {
    renderApp();
    await waitFor(() => expect(screen.getByText("3000")).toBeTruthy());
    expect(screen.getByText(/6 ports · 4 dev/)).toBeTruthy();

    const search = screen.getByLabelText("Search port, app or folder");
    fireEvent.change(search, { target: { value: "control" } });
    expect(screen.getByText(/1 ports · 0 dev/)).toBeTruthy();
  });

  it("only-secondary search results are shown, not the empty state", async () => {
    renderApp();
    await waitFor(() => expect(screen.getByText("3000")).toBeTruthy());

    const search = screen.getByLabelText("Search port, app or folder");
    fireEvent.change(search, { target: { value: "cupsd" } });

    expect(screen.getByText("631")).toBeTruthy();
    expect(screen.queryByText("No port matches cupsd")).toBeNull();
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
      for (const entry of MOCK_PORTS.filter((e) => e.category === "dev")) {
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
    await waitFor(() => expect(screen.getByText("3000")).toBeTruthy());
    expandSecondary();
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
    await waitFor(() => expect(screen.getByText("3000")).toBeTruthy());
    expandSecondary();
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
    await waitFor(() => expect(screen.getByText("3000")).toBeTruthy());
    expandSecondary();

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

  it("a category change on the armed row disarms the confirmation", async () => {
    const killSpy = vi.spyOn(portsModule, "killPort");
    const listSpy = vi.spyOn(portsModule, "listPorts");
    renderApp();
    await waitFor(() => expect(screen.getByText("3000")).toBeTruthy());
    expandSecondary();
    hoverRow(7000);

    // Arm the confirmation on the system row (port 7000).
    killShortcut();
    expect(killSpy).not.toHaveBeenCalled();

    // Simulate the next poll re-classifying that same process as `dev`
    // (e.g. it was reclassified). The armed target's category no longer
    // matches, so the confirmation must disarm rather than confirm on a
    // target the user never saw armed under its new category.
    listSpy.mockResolvedValueOnce(
      MOCK_PORTS.map((e) => (e.port === 7000 ? { ...e, category: "dev" } : e)),
    );
    await waitFor(() => expect(listSpy.mock.calls.length).toBeGreaterThan(1), { timeout: 3000 });

    // Wait for the refetched data (still port 7000, now category "dev")
    // to land and the row to still be present.
    await waitFor(() => expect(screen.getByText("7000")).toBeTruthy(), { timeout: 3000 });

    // A second shortcut must arm-again (dev rows kill immediately on
    // keyboard, so this call now kills directly) rather than confirming
    // the stale `system`-category arm.
    hoverRow(7000);
    killShortcut();
    expect(killSpy).toHaveBeenCalledTimes(1);
    expect(killSpy).toHaveBeenCalledWith(expect.objectContaining({ port: 7000, category: "dev" }));
  }, 8000);

  it("a locked row never calls killPort, pointer or keyboard", async () => {
    const killSpy = vi.spyOn(portsModule, "killPort");
    renderApp();
    await waitFor(() => expect(screen.getByText("3000")).toBeTruthy());
    expandSecondary();
    hoverRow(631);

    killShortcut();
    killShortcut();
    expect(killSpy).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(/Kill cupsd/)).toBeNull();
  });

  // F7 Slice 3: tabs, watch/remove wiring. Exhaustive composed regression
  // (12-case suite) is F7 Slice 5's job — these are basic wiring checks.
  describe("Favourites tab", () => {
    it("defaults to Listening and switches tabs by click, resetting query on switch", async () => {
      renderApp();
      await waitFor(() => expect(screen.getByText("3000")).toBeTruthy());
      expect(screen.getByRole("tab", { name: /listening/i }).getAttribute("aria-selected")).toBe(
        "true",
      );

      fireEvent.change(screen.getByLabelText(/search/i), { target: { value: "next" } });
      fireEvent.click(screen.getByRole("tab", { name: /favourites/i }));

      expect(screen.getByRole("tab", { name: /favourites/i }).getAttribute("aria-selected")).toBe(
        "true",
      );
      expect(screen.getByText("No watched ports yet")).toBeTruthy();
      expect((screen.getByLabelText(/search/i) as HTMLInputElement).value).toBe("");
    });

    it("watching a Listening row surfaces it under Favourites", async () => {
      renderApp();
      await waitFor(() => expect(screen.getByText("3000")).toBeTruthy());

      fireEvent.click(screen.getByRole("button", { name: "Watch port 3000" }));
      expect(screen.getByRole("button", { name: "Port 3000 is watched" })).toBeTruthy();

      fireEvent.click(screen.getByRole("tab", { name: /favourites/i }));
      expect(screen.getByText("in use")).toBeTruthy();
      expect(screen.getByText("Next.js dev")).toBeTruthy();
    });

    it("Left/Right arrow keys move and activate tabs without touching list navigation", async () => {
      renderApp();
      await waitFor(() => expect(screen.getByText("3000")).toBeTruthy());

      const listeningTab = screen.getByRole("tab", { name: /listening/i });
      listeningTab.focus();
      fireEvent.keyDown(listeningTab, { key: "ArrowRight" });

      expect(screen.getByRole("tab", { name: /favourites/i }).getAttribute("aria-selected")).toBe(
        "true",
      );
      // The row list must not have reacted to this arrow key.
      expect(screen.getByText("No watched ports yet")).toBeTruthy();
    });

    it("removing a watch from Favourites never calls killPort", async () => {
      const killSpy = vi.spyOn(portsModule, "killPort");
      renderApp();
      await waitFor(() => expect(screen.getByText("3000")).toBeTruthy());

      fireEvent.click(screen.getByRole("button", { name: "Watch port 3000" }));
      fireEvent.click(screen.getByRole("tab", { name: /favourites/i }));
      fireEvent.click(screen.getByRole("button", { name: "Remove watched port 3000" }));

      expect(screen.getByText("No watched ports yet")).toBeTruthy();
      expect(killSpy).not.toHaveBeenCalled();
    });

    // F7 Slice 4: keyboard navigation/kill wired into Favourites, routed
    // through the same identity-based nav/confirm plumbing as Listening.
    it("arrow-down and ⌘⌫ operate on Favourites' listener rows once that tab is active", async () => {
      const killSpy = vi.spyOn(portsModule, "killPort");
      renderApp();
      await waitFor(() => expect(screen.getByText("3000")).toBeTruthy());

      fireEvent.click(screen.getByRole("button", { name: "Watch port 3000" }));
      fireEvent.click(screen.getByRole("tab", { name: /favourites/i }));
      await waitFor(() => expect(screen.getByText("in use")).toBeTruthy());

      // Port 3000 (dev, killable) is the only listener row on screen; the
      // shared nav auto-selects it, and ⌘⌫ on a dev row kills immediately.
      killShortcut();
      expect(killSpy).toHaveBeenCalledTimes(1);
      expect(killSpy).toHaveBeenCalledWith(expect.objectContaining({ port: 3000 }));
    });

    it("a free/unknown watch (nothing listening) is never a keyboard nav target or kill target", async () => {
      const killSpy = vi.spyOn(portsModule, "killPort");
      renderApp();
      await waitFor(() => expect(screen.getByText("3000")).toBeTruthy());
      fireEvent.click(screen.getByRole("tab", { name: /favourites/i }));

      // Watch a port nothing is listening on (not in MOCK_PORTS).
      fireEvent.click(screen.getByRole("button", { name: /watch a port/i }));
      fireEvent.change(screen.getByLabelText("Port"), { target: { value: "9999" } });
      fireEvent.submit(screen.getByLabelText("Port").closest("form")!);

      await waitFor(() => expect(screen.getByText("nothing listening")).toBeTruthy());
      // No synthetic PortRow was rendered for the free watch — its heading
      // has no accessible "Kill ... on port 9999" control.
      expect(screen.queryByLabelText(/on port 9999/)).toBeNull();

      // Nothing is navigable/killable: arrow keys and ⌘⌫ are both no-ops.
      fireEvent.keyDown(window, { key: "ArrowDown" });
      killShortcut();
      expect(killSpy).not.toHaveBeenCalled();
    });

    it("switching tabs disarms a pending keyboard confirmation", async () => {
      const killSpy = vi.spyOn(portsModule, "killPort");
      renderApp();
      await waitFor(() => expect(screen.getByText("3000")).toBeTruthy());

      // Watch the protected (system, two-step-confirm) port 7000.
      expandSecondary();
      fireEvent.click(screen.getByRole("button", { name: "Watch port 7000" }));
      fireEvent.click(screen.getByRole("tab", { name: /favourites/i }));
      await waitFor(() => expect(screen.getByText("in use")).toBeTruthy());

      hoverFavouriteRow(7000);
      killShortcut();
      expect(killSpy).not.toHaveBeenCalled();

      // Leaving and returning to the tab must not resurrect the arm.
      fireEvent.click(screen.getByRole("tab", { name: /listening/i }));
      fireEvent.click(screen.getByRole("tab", { name: /favourites/i }));
      await waitFor(() => expect(screen.getByText("in use")).toBeTruthy());

      hoverFavouriteRow(7000);
      killShortcut();
      expect(killSpy).not.toHaveBeenCalled();

      killShortcut();
      expect(killSpy).toHaveBeenCalledTimes(1);
      expect(killSpy).toHaveBeenCalledWith(expect.objectContaining({ port: 7000 }));
    });

    it("a stale snapshot disables the kill control (native disabled), pointer and keyboard", async () => {
      const killSpy = vi.spyOn(portsModule, "killPort");
      const listSpy = vi.spyOn(portsModule, "listPorts");
      renderApp({ retry: false });
      await waitFor(() => expect(screen.getByText("3000")).toBeTruthy());

      fireEvent.click(screen.getByRole("button", { name: "Watch port 3000" }));
      fireEvent.click(screen.getByRole("tab", { name: /favourites/i }));
      await waitFor(() => expect(screen.getByText("in use")).toBeTruthy());

      // Next poll fails: TanStack Query retains the last successful data
      // alongside the error, which `favouritesQueryHealth` reports as
      // "stale".
      listSpy.mockRejectedValueOnce(new Error("boom"));
      await waitFor(() => expect(screen.getByText(/in use · stale/)).toBeTruthy(), {
        timeout: 3000,
      });

      const killBtn = screen.getByLabelText(/Cannot kill .* on port 3000/);
      expect((killBtn as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(killBtn);
      expect(killSpy).not.toHaveBeenCalled();

      hoverFavouriteRow(3000);
      killShortcut();
      expect(killSpy).not.toHaveBeenCalled();
    }, 8000);

    // Global Enter must never hijack native button activation — Remove and
    // the row watch-toggle star both handle their own Enter via the
    // browser's default button-activation behavior. These assert the
    // global handler (a) does not call `preventDefault` on such an Enter,
    // and (b) does not itself expand/arm anything for it, then simulate
    // the native click a real browser would fire.
    it("Tab to a Remove button, Enter does not expand/arm anything and removes on activation", async () => {
      const killSpy = vi.spyOn(portsModule, "killPort");
      renderApp();
      await waitFor(() => expect(screen.getByText("3000")).toBeTruthy());

      fireEvent.click(screen.getByRole("button", { name: "Watch port 3000" }));
      fireEvent.click(screen.getByRole("tab", { name: /favourites/i }));
      await waitFor(() => expect(screen.getByText("in use")).toBeTruthy());

      const removeBtn = screen.getByRole("button", { name: "Remove watched port 3000" });
      removeBtn.focus();
      const notPrevented = fireEvent.keyDown(removeBtn, { key: "Enter" });
      expect(notPrevented).toBe(true);
      expect(killSpy).not.toHaveBeenCalled();
      expect(screen.getByText("in use")).toBeTruthy();

      // Simulate the browser's own Enter-on-button activation.
      fireEvent.click(removeBtn);
      expect(screen.getByText("No watched ports yet")).toBeTruthy();
    });

    it("Tab to a row's watch-toggle star, Enter does not expand/arm anything and toggles on activation", async () => {
      renderApp();
      await waitFor(() => expect(screen.getByText("3000")).toBeTruthy());

      const star = screen.getByRole("button", { name: "Watch port 3000" });
      star.focus();
      const notPrevented = fireEvent.keyDown(star, { key: "Enter" });
      expect(notPrevented).toBe(true);
      // Global Enter must not have expanded the row's detail panel.
      expect(screen.queryByText("PID")).toBeNull();
      expect(screen.getByRole("button", { name: "Watch port 3000" })).toBeTruthy();

      fireEvent.click(star);
      expect(screen.getByRole("button", { name: "Port 3000 is watched" })).toBeTruthy();
    });
  });
});
