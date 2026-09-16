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

  // F7 Slice 5: composed regression for the 12 required behavioral cases.
  // "Remount" below is the jsdom-level proxy for "app restart" — a fresh
  // `<App />` mount against jsdom's still-populated `localStorage` (never
  // cleared mid-test, only in the outer `afterEach`). True OS-level
  // process/app restart is native-only and is not exercised here.
  describe("Slice 5 — composed regression", () => {
    // Case 1: add named free port, remount, switch to Favourites.
    it("a named free-port watch survives a remount and the app still starts on Listening", async () => {
      const { unmount } = renderApp();
      await waitFor(() => expect(screen.getByText("3000")).toBeTruthy());

      fireEvent.click(screen.getByRole("tab", { name: /favourites/i }));
      fireEvent.click(screen.getByRole("button", { name: /watch a port/i }));
      fireEvent.change(screen.getByLabelText("Port"), { target: { value: "9999" } });
      fireEvent.change(screen.getByLabelText("Name (optional)"), {
        target: { value: "Staging API" },
      });
      fireEvent.submit(screen.getByLabelText("Port").closest("form")!);
      await waitFor(() => expect(screen.getByText(/Staging API/)).toBeTruthy());

      unmount();

      renderApp();
      await waitFor(() => expect(screen.getByText("3000")).toBeTruthy());
      expect(screen.getByRole("tab", { name: /listening/i }).getAttribute("aria-selected")).toBe(
        "true",
      );
      fireEvent.click(screen.getByRole("tab", { name: /favourites/i }));
      expect(screen.getByText(/Staging API/)).toBeTruthy();
      expect(screen.getByText("nothing listening")).toBeTruthy();
    });

    // Case 2: watching via a listening row, then a second PID on the same
    // port shows watched state too, and the favourites count increases
    // only once (one saved record, not one per listener row).
    it("watching one PID on a port marks every PID on that port as watched, counted once", async () => {
      const listSpy = vi.spyOn(portsModule, "listPorts");
      renderApp();
      await waitFor(() => expect(screen.getByText("3000")).toBeTruthy());

      fireEvent.click(screen.getByRole("button", { name: "Watch port 3000" }));
      expect(screen.getByRole("tab", { name: /favourites/i }).textContent).toContain("1");

      const secondListener = {
        ...MOCK_PORTS.find((e) => e.port === 3000)!,
        pid: 9101,
        startedAt: Math.floor(Date.now() / 1000) - 60,
        label: "Next.js dev (2)",
      };
      listSpy.mockResolvedValueOnce([...MOCK_PORTS, secondListener]);
      await waitFor(() => expect(screen.getByText("Next.js dev (2)")).toBeTruthy(), {
        timeout: 3000,
      });

      // Still one saved favourite, not two.
      expect(screen.getByRole("tab", { name: /favourites/i }).textContent).toContain("1");
      expect(screen.getAllByRole("button", { name: "Port 3000 is watched" }).length).toBe(2);
    }, 8000);

    // Case 3: an honest successful-empty snapshot is "free"; a snapshot
    // that never resolved, or resolved with an error and no prior data,
    // must never show the free/in-use presentation at all.
    it("an empty successful snapshot shows free; loading/error-with-no-data never shows free or in-use", async () => {
      window.localStorage.setItem(
        "chapay.favourites",
        JSON.stringify([{ port: 3000, name: "API" }]),
      );
      let resolveList!: (v: typeof MOCK_PORTS) => void;
      const listSpy = vi
        .spyOn(portsModule, "listPorts")
        .mockReturnValue(new Promise((resolve) => (resolveList = resolve)));

      renderApp();
      fireEvent.click(screen.getByRole("tab", { name: /favourites/i }));

      // Still loading: neither free nor in-use presentation is shown.
      expect(screen.getByText("checking…")).toBeTruthy();
      expect(screen.queryByText("nothing listening")).toBeNull();
      expect(screen.queryByText("in use")).toBeNull();

      resolveList([]);
      await waitFor(() => expect(screen.getByText("nothing listening")).toBeTruthy());
      expect(screen.queryByText(/stale/)).toBeNull();
      listSpy.mockRestore();
    });

    // Case 4: free -> in use -> free across successive polls, with no
    // localStorage write anywhere in that sequence (only a mutation, never
    // a live-status change, may write the favourites key).
    it("free/in-use/free transitions across polls never touch localStorage", async () => {
      window.localStorage.setItem("chapay.favourites", JSON.stringify([{ port: 3000 }]));
      const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
      const listSpy = vi.spyOn(portsModule, "listPorts").mockResolvedValue([]);

      renderApp();
      fireEvent.click(screen.getByRole("tab", { name: /favourites/i }));
      await waitFor(() => expect(screen.getByText("nothing listening")).toBeTruthy());
      setItemSpy.mockClear();

      listSpy.mockResolvedValueOnce(MOCK_PORTS);
      await waitFor(() => expect(screen.getByText("in use")).toBeTruthy(), { timeout: 3000 });
      expect(setItemSpy).not.toHaveBeenCalled();

      listSpy.mockResolvedValueOnce([]);
      await waitFor(() => expect(screen.getByText("nothing listening")).toBeTruthy(), {
        timeout: 3000,
      });
      expect(setItemSpy).not.toHaveBeenCalled();
    }, 8000);

    // Case 5: a PID/start-time replacement (the same process died, a new
    // one reused the port) must render the latest metadata and must never
    // let a pointer-armed confirmation against the old incarnation
    // confirm-kill the new one.
    it("a PID/start-time replacement renders fresh metadata and voids an old armed confirmation", async () => {
      const killSpy = vi.spyOn(portsModule, "killPort");
      const listSpy = vi.spyOn(portsModule, "listPorts");
      renderApp();
      await waitFor(() => expect(screen.getByText("3000")).toBeTruthy());

      fireEvent.click(screen.getByRole("button", { name: "Watch port 3000" }));
      fireEvent.click(screen.getByRole("tab", { name: /favourites/i }));
      await waitFor(() => expect(screen.getByText("in use")).toBeTruthy());

      // Arm (pointer) the original incarnation (pid 4101).
      fireEvent.click(screen.getByLabelText("Kill Next.js dev on port 3000"));
      expect(screen.getByText("Kill?")).toBeTruthy();

      // The process restarted: new pid, new startedAt, same port/label.
      const original = MOCK_PORTS.find((e) => e.port === 3000)!;
      const replaced = { ...original, pid: 9999, startedAt: Math.floor(Date.now() / 1000) };
      // Stable from here on (not just "once") so a subsequent real poll
      // during the test can't silently revert the port back to the old
      // incarnation and make the assertions below flaky.
      listSpy.mockResolvedValue(MOCK_PORTS.map((e) => (e.port === 3000 ? replaced : e)));
      await waitFor(() => expect(listSpy.mock.calls.length).toBeGreaterThan(1), { timeout: 3000 });
      await waitFor(() => expect(screen.queryByText("Kill?")).toBeNull(), { timeout: 3000 });

      // Confirming now must be impossible against the stale target: the
      // row un-armed, so this click only re-arms the new incarnation.
      // Select the (now-different-key) row first, matching how a real
      // pointer interaction would hover it before clicking its kill
      // button — arming requires the armed row to also be the selected
      // one (see App's disarm effect).
      const newKillBtn = screen.getByLabelText("Kill Next.js dev on port 3000");
      fireEvent.mouseEnter(newKillBtn.closest("li")!);
      fireEvent.click(newKillBtn);
      expect(killSpy).not.toHaveBeenCalled();
      fireEvent.click(screen.getByLabelText("Kill Next.js dev on port 3000"));
      expect(killSpy).toHaveBeenCalledTimes(1);
      expect(killSpy).toHaveBeenCalledWith(expect.objectContaining({ pid: 9999, port: 3000 }));
    }, 8000);

    // Case 6: two PIDs on one watched port render two independent kill
    // actions but count as one "in use" watch; killing one targets only
    // that PID.
    it("two PIDs on one watched port: two kill actions, one in-use count, kill targets only the chosen PID", async () => {
      const killSpy = vi.spyOn(portsModule, "killPort").mockResolvedValue("terminated");
      const listSpy = vi.spyOn(portsModule, "listPorts");
      const second = {
        ...MOCK_PORTS.find((e) => e.port === 3000)!,
        pid: 9101,
        label: "Next.js dev (2)",
      };
      listSpy.mockResolvedValue([...MOCK_PORTS, second]);

      window.localStorage.setItem("chapay.favourites", JSON.stringify([{ port: 3000 }]));
      renderApp();
      fireEvent.click(screen.getByRole("tab", { name: /favourites/i }));
      await waitFor(() => expect(screen.getByText("Next.js dev (2)")).toBeTruthy());

      // One "in use" watch — not two.
      expect(screen.getByText(/^1 watched · 1 in use$/)).toBeTruthy();

      const killBtns = screen.getAllByLabelText(/^Kill Next\.js dev.*on port 3000$/);
      expect(killBtns.length).toBe(2);

      // Select the second row first (arming requires the armed row to
      // also be the selected one), then arm-then-confirm its action only.
      fireEvent.mouseEnter(killBtns[1].closest("li")!);
      fireEvent.click(killBtns[1]);
      fireEvent.click(screen.getByText("Kill?"));
      await waitFor(() => expect(killSpy).toHaveBeenCalledTimes(1));
      expect(killSpy).toHaveBeenCalledWith(expect.objectContaining({ pid: 9101, port: 3000 }));
    });

    // Case 7: the app/system two-action shortcut requirement, and the
    // locked-row guard, both hold inside Favourites too.
    it("a locked watched row never invokes killPort, pointer or keyboard, inside Favourites", async () => {
      const killSpy = vi.spyOn(portsModule, "killPort");
      window.localStorage.setItem("chapay.favourites", JSON.stringify([{ port: 631 }]));
      renderApp();
      await waitFor(() => expect(screen.getByText("3000")).toBeTruthy());
      fireEvent.click(screen.getByRole("tab", { name: /favourites/i }));
      await waitFor(() => expect(screen.getByText("cupsd")).toBeTruthy());

      // No kill control exists for an unkillable row.
      expect(screen.queryByLabelText(/Kill cupsd/)).toBeNull();

      const lockedRow = screen.getByLabelText("Belongs to another user").closest("li")!;
      fireEvent.mouseEnter(lockedRow);
      killShortcut();
      killShortcut();
      expect(killSpy).not.toHaveBeenCalled();
    });

    // Case 8: removing a favourite that currently has live listeners never
    // kills anything (already covered for a free watch above); a write
    // failure on remove must retain the record and surface the error.
    it("a write failure on remove retains the favourite and surfaces an error", async () => {
      renderApp();
      await waitFor(() => expect(screen.getByText("3000")).toBeTruthy());
      fireEvent.click(screen.getByRole("button", { name: "Watch port 3000" }));
      fireEvent.click(screen.getByRole("tab", { name: /favourites/i }));
      await waitFor(() => expect(screen.getByText("in use")).toBeTruthy());

      const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("quota exceeded");
      });

      fireEvent.click(screen.getByRole("button", { name: "Remove watched port 3000" }));

      expect(screen.getByText("Could not save watched ports")).toBeTruthy();
      // The record survives: still rendered, not reverted to the empty
      // state.
      expect(screen.getByText("in use")).toBeTruthy();
      setItemSpy.mockRestore();
    });

    // Case 9: the inline form is an excluded keyboard scope end-to-end —
    // Escape closes only the form (never the panel/window), and arrow
    // keys/⌘⌫ typed while the form is focused never reach row navigation.
    it("Escape in the watch form only closes the form; arrows/⌘⌫ inside it never reach row navigation", async () => {
      const killSpy = vi.spyOn(portsModule, "killPort");
      window.localStorage.setItem("chapay.favourites", JSON.stringify([{ port: 3000 }]));
      renderApp();
      await waitFor(() => expect(screen.getByText("3000")).toBeTruthy());
      fireEvent.click(screen.getByRole("tab", { name: /favourites/i }));
      await waitFor(() => expect(screen.getByText("in use")).toBeTruthy());

      fireEvent.click(screen.getByRole("button", { name: /watch a port/i }));
      const portInput = screen.getByLabelText("Port");

      fireEvent.keyDown(portInput, { key: "ArrowDown" });
      fireEvent.keyDown(portInput, { key: "Backspace", metaKey: true });
      expect(killSpy).not.toHaveBeenCalled();
      // The form is still open (arrows/⌘⌫ did not close/expand anything).
      expect(screen.getByLabelText("Port")).toBeTruthy();

      fireEvent.keyDown(portInput, { key: "Escape" });
      // Form closed; the Favourites panel (and its watched list) is
      // still showing — Escape did not hide the whole panel.
      expect(screen.queryByLabelText("Port")).toBeNull();
      expect(screen.getByText("in use")).toBeTruthy();
    });

    // Case 10: search matches by saved name or a live field keep every
    // listener row for that watch; clearing restores the full list.
    it("search by saved name and by a live field each keep all of a matching watch's listener rows", async () => {
      const listSpy = vi.spyOn(portsModule, "listPorts");
      const second = {
        ...MOCK_PORTS.find((e) => e.port === 3000)!,
        pid: 9101,
        label: "Next.js dev (2)",
      };
      listSpy.mockResolvedValue([...MOCK_PORTS, second]);
      window.localStorage.setItem(
        "chapay.favourites",
        JSON.stringify([{ port: 3000, name: "Frontend" }, { port: 5432 }]),
      );

      renderApp();
      await waitFor(() => expect(screen.getByText("Next.js dev")).toBeTruthy());
      fireEvent.click(screen.getByRole("tab", { name: /favourites/i }));
      await waitFor(() => expect(screen.getByText("Next.js dev (2)")).toBeTruthy());

      const search = screen.getByLabelText("Search port, app or folder");

      // Match by saved name.
      fireEvent.change(search, { target: { value: "Frontend" } });
      expect(screen.getByText("Next.js dev")).toBeTruthy();
      expect(screen.getByText("Next.js dev (2)")).toBeTruthy();
      expect(screen.queryByText("PostgreSQL")).toBeNull();

      // Match by a live field (project name) instead.
      fireEvent.change(search, { target: { value: "tapuy-web" } });
      expect(screen.getByText("Next.js dev")).toBeTruthy();
      expect(screen.getByText("Next.js dev (2)")).toBeTruthy();

      fireEvent.change(search, { target: { value: "" } });
      await waitFor(() => expect(screen.getByText("PostgreSQL")).toBeTruthy());
    });

    // Case 12: kill toast copy and pending-disable behavior in Favourites
    // match Listening — including the rejected-IPC path.
    it("Favourites: a rejected kill shows a failure toast and the row is never left stuck disabled", async () => {
      const killSpy = vi.spyOn(portsModule, "killPort").mockRejectedValueOnce(new Error("nope"));
      renderApp();
      await waitFor(() => expect(screen.getByText("3000")).toBeTruthy());
      fireEvent.click(screen.getByRole("button", { name: "Watch port 3000" }));
      fireEvent.click(screen.getByRole("tab", { name: /favourites/i }));
      await waitFor(() => expect(screen.getByText("in use")).toBeTruthy());

      const killBtn = screen.getByLabelText("Kill Next.js dev on port 3000");
      fireEvent.click(killBtn);
      fireEvent.click(screen.getByText("Kill?"));

      await waitFor(() => {
        const toast = screen.getByRole("status");
        expect(toast.textContent).toContain("Could not kill");
      });
      expect(killSpy).toHaveBeenCalledTimes(1);

      // Not stuck: a fresh arm-then-confirm still reaches killPort again.
      fireEvent.click(screen.getByLabelText("Kill Next.js dev on port 3000"));
      fireEvent.click(screen.getByText("Kill?"));
      await waitFor(() => expect(killSpy).toHaveBeenCalledTimes(2));
    });

    // Case 12 (toast copy): the copy action on a stopped toast copies the
    // process's command, matching Listening's Toast usage.
    it("Favourites: a stopped-process toast offers Copy command and copies it", async () => {
      vi.spyOn(portsModule, "killPort").mockResolvedValueOnce("terminated");
      const writeTextSpy = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, { clipboard: { writeText: writeTextSpy } });

      renderApp();
      await waitFor(() => expect(screen.getByText("3000")).toBeTruthy());
      fireEvent.click(screen.getByRole("button", { name: "Watch port 3000" }));
      fireEvent.click(screen.getByRole("tab", { name: /favourites/i }));
      await waitFor(() => expect(screen.getByText("in use")).toBeTruthy());

      fireEvent.click(screen.getByLabelText("Kill Next.js dev on port 3000"));
      fireEvent.click(screen.getByText("Kill?"));

      await waitFor(() => expect(screen.getByRole("status")).toBeTruthy());
      fireEvent.click(screen.getByRole("button", { name: /copy command/i }));
      expect(writeTextSpy).toHaveBeenCalledWith(expect.stringContaining("next dev"));
    });
  });
});
