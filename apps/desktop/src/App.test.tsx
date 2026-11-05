import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { MOCK_PORTS } from "@/lib/mock-ports";
import * as portsModule from "@/lib/ports";
import * as thermalModule from "@/lib/thermal";
import { getSetting, resetMemorySettings, setSetting } from "@/settings/store";

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
 * directly on the `<li>` to move selection, the same way App.tsx does.
 * Pass the listbox when the port is also drawn in Favourites. */
function hoverRow(port: number, listbox?: string) {
  const scope = listbox ? within(screen.getByRole("listbox", { name: listbox })) : screen;
  fireEvent.mouseEnter(scope.getByText(String(port)).closest("li")!);
}

/** The listener rows under one watch in the Favourites section. */
function favouriteRows(port: number) {
  return within(screen.getByRole("listbox", { name: `Listeners on port ${port}` }));
}

function hoverFavouriteRow(port: number) {
  fireEvent.mouseEnter(favouriteRows(port).getAllByRole("option")[0]);
}

function devRows() {
  return within(screen.getByRole("listbox", { name: "Dev ports" }));
}

/** The one highlighted row; fails if none or more than one is. */
function selectedRow() {
  return screen.getByRole("option", { selected: true });
}

function favouritesHeader() {
  return screen.getByRole("button", { name: /^favourites/i });
}

function portsTab() {
  return screen.getByRole("tab", { name: /^ports/i });
}

function thermalTab() {
  return screen.getByRole("tab", { name: /^thermal/i });
}

function searchField() {
  return screen.getByLabelText("Search port, app or folder") as HTMLInputElement;
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
    resetMemorySettings();
  });

  it("opens Settings from the footer's gear button and from ⌘,", async () => {
    const openSettings = vi.spyOn(portsModule, "openSettings").mockResolvedValue();
    renderApp();
    await screen.findByText("3000");

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(openSettings).toHaveBeenCalledTimes(1);
    expect(openSettings).toHaveBeenLastCalledWith();

    fireEvent.keyDown(window, { key: ",", metaKey: true, code: "Comma" });
    expect(openSettings).toHaveBeenCalledTimes(2);
    expect(openSettings).toHaveBeenLastCalledWith();
  });

  it("Confirm before kill off: × kills a dev row on the first click", async () => {
    await setSetting("confirmBeforeKill", false);
    const killSpy = vi.spyOn(portsModule, "killPort");
    renderApp();
    await waitFor(() => expect(screen.getByText("3000")).toBeTruthy());
    // The setting loads asynchronously; wait for it before clicking.
    await waitFor(() => {
      fireEvent.click(screen.getByLabelText("Kill Next.js dev on port 3000"));
      expect(killSpy).toHaveBeenCalledTimes(1);
    });
    expect(killSpy).toHaveBeenCalledWith(expect.objectContaining({ port: 3000 }));
    expect(screen.queryByText("Kill?")).toBeNull();
  });

  it("Show apps & system off: the Apps & System group is gone", async () => {
    await setSetting("showAppsAndSystem", false);
    renderApp();
    await waitFor(() => expect(screen.getByText("3000")).toBeTruthy());
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /apps & system/i })).toBeNull(),
    );
    expect(screen.queryByText("7000")).toBeNull();
    expect(screen.queryByText("631")).toBeNull();
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

  it("⌘⌫ with the search input focused never kills the selected row", async () => {
    const killSpy = vi.spyOn(portsModule, "killPort");
    renderApp();
    await waitFor(() => expect(screen.getByText("3000")).toBeTruthy());

    const search = screen.getByLabelText("Search port, app or folder");
    fireEvent.keyDown(search, { key: "Backspace", metaKey: true, code: "Backspace" });
    expect(killSpy).not.toHaveBeenCalled();
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

  // The Ports tab: the Favourites section above the listening list, one
  // keyboard list across both, and the tab row. Exhaustive composed
  // regression is the Slice 5 suite below — these are wiring checks.
  describe("Ports tab", () => {
    it("defaults to Ports and switches to Thermal by click, resetting the query and hiding search", async () => {
      renderApp();
      await waitFor(() => expect(screen.getByText("3000")).toBeTruthy());
      expect(portsTab().getAttribute("aria-selected")).toBe("true");
      expect(thermalTab().getAttribute("aria-selected")).toBe("false");

      fireEvent.change(searchField(), { target: { value: "next" } });
      fireEvent.click(thermalTab());

      expect(thermalTab().getAttribute("aria-selected")).toBe("true");
      expect(await screen.findByText("Thermal history in Settings")).toBeTruthy();
      expect(searchField().value).toBe("");
      expect(searchField().closest("[hidden]")).toBeTruthy();

      fireEvent.click(portsTab());
      expect(searchField().closest("[hidden]")).toBeNull();
      expect(screen.getByText("3000")).toBeTruthy();
    });

    it("the Ports tab counts listening ports", async () => {
      renderApp();
      await waitFor(() => expect(screen.getByText("3000")).toBeTruthy());
      expect(portsTab().textContent).toBe(`Ports${MOCK_PORTS.length}`);
    });

    it("watching a listening row adds it to the Favourites section, so the port shows twice", async () => {
      renderApp();
      await waitFor(() => expect(screen.getByText("3000")).toBeTruthy());

      fireEvent.click(screen.getByRole("button", { name: "Watch port 3000" }));
      expect(screen.getByRole("button", { name: "Port 3000 is watched" })).toBeTruthy();

      expect(favouritesHeader().textContent).toBe("FAVOURITES · 1");
      expect(screen.getByText("in use")).toBeTruthy();
      expect(favouriteRows(3000).getByText("Next.js dev")).toBeTruthy();
      expect(devRows().getByText("Next.js dev")).toBeTruthy();
    });

    it("Left/Right/Home/End on the tablist move and activate tabs without touching list navigation", async () => {
      const killSpy = vi.spyOn(portsModule, "killPort");
      renderApp();
      await waitFor(() => expect(screen.getByText("3000")).toBeTruthy());

      portsTab().focus();
      fireEvent.keyDown(portsTab(), { key: "ArrowRight" });
      expect(thermalTab().getAttribute("aria-selected")).toBe("true");
      expect(document.activeElement).toBe(thermalTab());

      fireEvent.keyDown(thermalTab(), { key: "ArrowLeft" });
      expect(portsTab().getAttribute("aria-selected")).toBe("true");
      expect(document.activeElement).toBe(portsTab());

      fireEvent.keyDown(portsTab(), { key: "End" });
      expect(thermalTab().getAttribute("aria-selected")).toBe("true");
      fireEvent.keyDown(thermalTab(), { key: "Home" });
      expect(portsTab().getAttribute("aria-selected")).toBe("true");

      // The row list never reacted: the default selection is untouched.
      expect(selectedRow().textContent).toContain("3000");
      expect(killSpy).not.toHaveBeenCalled();
    });

    it("removing a watch never calls killPort", async () => {
      const killSpy = vi.spyOn(portsModule, "killPort");
      renderApp();
      await waitFor(() => expect(screen.getByText("3000")).toBeTruthy());

      fireEvent.click(screen.getByRole("button", { name: "Watch port 3000" }));
      fireEvent.click(screen.getByRole("button", { name: "Remove watched port 3000" }));

      expect(screen.queryByText("in use")).toBeNull();
      expect(favouritesHeader().textContent).toBe("FAVOURITES · 0");
      expect(killSpy).not.toHaveBeenCalled();
    });

    it("the Favourites header collapses and expands the section, and the state persists", async () => {
      window.localStorage.setItem("chapay.favourites", JSON.stringify([{ port: 3000 }]));
      const { unmount } = renderApp();
      await waitFor(() => expect(screen.getByText("in use")).toBeTruthy());
      expect(favouritesHeader().getAttribute("aria-expanded")).toBe("true");

      fireEvent.click(favouritesHeader());
      expect(favouritesHeader().getAttribute("aria-expanded")).toBe("false");
      expect(screen.queryByText("in use")).toBeNull();
      expect(screen.queryByRole("button", { name: /watch a port/i })).toBeNull();
      await waitFor(async () => expect(await getSetting("favouritesCollapsed")).toBe(true));

      unmount();
      renderApp();
      await waitFor(() => expect(screen.getByText("3000")).toBeTruthy());
      expect(favouritesHeader().getAttribute("aria-expanded")).toBe("false");
      expect(screen.queryByText("in use")).toBeNull();

      fireEvent.click(favouritesHeader());
      expect(favouritesHeader().getAttribute("aria-expanded")).toBe("true");
      expect(screen.getByText("in use")).toBeTruthy();
      await waitFor(async () => expect(await getSetting("favouritesCollapsed")).toBe(false));
    });

    it("a search with favourite matches forces a collapsed Favourites section open", async () => {
      window.localStorage.setItem(
        "chapay.favourites",
        JSON.stringify([{ port: 3000, name: "Frontend" }]),
      );
      renderApp();
      await waitFor(() => expect(screen.getByText("in use")).toBeTruthy());
      fireEvent.click(favouritesHeader());
      expect(screen.queryByText("in use")).toBeNull();

      fireEvent.change(searchField(), { target: { value: "Frontend" } });
      const header = screen.getByRole("button", {
        name: /favourites — expanded for search results/i,
      });
      expect(header.getAttribute("aria-expanded")).toBe("true");
      expect((header as HTMLButtonElement).disabled).toBe(true);
      expect(screen.getByText("in use")).toBeTruthy();
      // The match is a favourite, so the listening list adds no "no match".
      expect(screen.queryByText(/No port matches/)).toBeNull();

      // Clearing the query restores the saved (collapsed) state.
      fireEvent.change(searchField(), { target: { value: "" } });
      expect(favouritesHeader().getAttribute("aria-expanded")).toBe("false");
      expect(screen.queryByText("in use")).toBeNull();
    });

    it("a search with no favourite match hides the Favourites section", async () => {
      window.localStorage.setItem("chapay.favourites", JSON.stringify([{ port: 3000 }]));
      renderApp();
      await waitFor(() => expect(screen.getByText("in use")).toBeTruthy());

      fireEvent.change(searchField(), { target: { value: "postgres" } });
      expect(screen.queryByRole("button", { name: /^favourites/i })).toBeNull();
      expect(screen.getByText("5432")).toBeTruthy();
    });

    it("arrows walk favourite rows then listening rows as one list, highlighting one row when a port shows twice", async () => {
      window.localStorage.setItem("chapay.favourites", JSON.stringify([{ port: 3000 }]));
      renderApp();
      await waitFor(() => expect(screen.getByText("in use")).toBeTruthy());

      // First row of the merged list: the favourite copy of 3000.
      await waitFor(() =>
        expect(selectedRow().closest("ul")!.getAttribute("aria-label")).toBe(
          "Listeners on port 3000",
        ),
      );

      // ↓ reaches the listening copy of the same process, not 5173.
      fireEvent.keyDown(window, { key: "ArrowDown" });
      expect(selectedRow().closest("ul")!.getAttribute("aria-label")).toBe("Dev ports");
      expect(selectedRow().textContent).toContain("3000");

      fireEvent.keyDown(window, { key: "ArrowDown" });
      expect(selectedRow().textContent).toContain("5173");

      fireEvent.keyDown(window, { key: "ArrowUp" });
      fireEvent.keyDown(window, { key: "ArrowUp" });
      expect(selectedRow().closest("ul")!.getAttribute("aria-label")).toBe(
        "Listeners on port 3000",
      );
    });

    it("Enter expands only the selected copy of a port shown twice", async () => {
      window.localStorage.setItem("chapay.favourites", JSON.stringify([{ port: 3000 }]));
      renderApp();
      await waitFor(() => expect(screen.getByText("in use")).toBeTruthy());
      await waitFor(() =>
        expect(favouriteRows(3000).getByRole("option").getAttribute("aria-selected")).toBe("true"),
      );

      fireEvent.keyDown(window, { key: "Enter" });
      expect(screen.getAllByText("PID").length).toBe(1);
      expect(favouriteRows(3000).getByText("PID")).toBeTruthy();
    });

    it("⌘⌫ arms only the selected copy of a protected port shown twice", async () => {
      const killSpy = vi.spyOn(portsModule, "killPort");
      window.localStorage.setItem("chapay.favourites", JSON.stringify([{ port: 7000 }]));
      renderApp();
      await waitFor(() => expect(screen.getByText("in use")).toBeTruthy());
      expandSecondary();

      hoverFavouriteRow(7000);
      killShortcut();
      expect(killSpy).not.toHaveBeenCalled();
      expect(screen.getAllByText("Kill system?").length).toBe(1);
      expect(favouriteRows(7000).getByText("Kill system?")).toBeTruthy();

      // Moving to the listening copy is a different row: it disarms.
      hoverRow(7000, "Apps & System ports");
      expect(screen.queryByText("Kill system?")).toBeNull();
      killShortcut();
      expect(killSpy).not.toHaveBeenCalled();
      killShortcut();
      expect(killSpy).toHaveBeenCalledTimes(1);
      expect(killSpy).toHaveBeenCalledWith(expect.objectContaining({ port: 7000 }));
    });

    it("collapsing Favourites moves a selection inside it to the first listening row", async () => {
      const killSpy = vi.spyOn(portsModule, "killPort");
      window.localStorage.setItem("chapay.favourites", JSON.stringify([{ port: 5173 }]));
      renderApp();
      await waitFor(() => expect(screen.getByText("in use")).toBeTruthy());
      hoverFavouriteRow(5173);
      expect(selectedRow().closest("ul")!.getAttribute("aria-label")).toBe(
        "Listeners on port 5173",
      );

      fireEvent.click(favouritesHeader());
      expect(selectedRow().closest("ul")!.getAttribute("aria-label")).toBe("Dev ports");
      expect(selectedRow().textContent).toContain("3000");

      // The hidden favourite rows are out of navigation: ⌘⌫ acts on 3000.
      killShortcut();
      expect(killSpy).toHaveBeenCalledWith(expect.objectContaining({ port: 3000 }));
    });

    // F7 Slice 4: keyboard navigation/kill on favourite rows, routed
    // through the same identity-based nav/confirm plumbing as listening.
    it("arrow keys and ⌘⌫ operate on a favourite listener row", async () => {
      const killSpy = vi.spyOn(portsModule, "killPort");
      renderApp();
      await waitFor(() => expect(screen.getByText("3000")).toBeTruthy());

      fireEvent.click(screen.getByRole("button", { name: "Watch port 5432" }));
      await waitFor(() => expect(screen.getByText("in use")).toBeTruthy());

      // The default selection stays on listening 3000; ↑ moves to the
      // favourite row above it (5432), and ⌘⌫ on a dev row kills at once.
      fireEvent.keyDown(window, { key: "ArrowUp" });
      expect(selectedRow().closest("ul")!.getAttribute("aria-label")).toBe(
        "Listeners on port 5432",
      );
      killShortcut();
      expect(killSpy).toHaveBeenCalledTimes(1);
      expect(killSpy).toHaveBeenCalledWith(expect.objectContaining({ port: 5432 }));
    });

    it("a free/unknown watch (nothing listening) is never a keyboard nav target or kill target", async () => {
      const killSpy = vi.spyOn(portsModule, "killPort");
      renderApp();
      await waitFor(() => expect(screen.getByText("3000")).toBeTruthy());

      // Watch a port nothing is listening on (not in MOCK_PORTS).
      fireEvent.click(screen.getByRole("button", { name: /watch a port/i }));
      fireEvent.change(screen.getByLabelText("Port"), { target: { value: "9999" } });
      fireEvent.submit(screen.getByLabelText("Port").closest("form")!);

      await waitFor(() => expect(screen.getByText("nothing listening")).toBeTruthy());
      // No synthetic PortRow was rendered for the free watch — its heading
      // has no accessible "Kill ... on port 9999" control.
      expect(screen.queryByLabelText(/on port 9999/)).toBeNull();

      // ↑ from the first listening row has nowhere to go: the free watch
      // contributes no row, so nothing on port 9999 is ever selected.
      fireEvent.keyDown(window, { key: "ArrowUp" });
      expect(selectedRow().closest("ul")!.getAttribute("aria-label")).toBe("Dev ports");
      killShortcut();
      expect(killSpy).not.toHaveBeenCalledWith(expect.objectContaining({ port: 9999 }));
    });

    it("switching tabs disarms a pending keyboard confirmation", async () => {
      const killSpy = vi.spyOn(portsModule, "killPort");
      renderApp();
      await waitFor(() => expect(screen.getByText("3000")).toBeTruthy());

      // Watch the protected (system, two-step-confirm) port 7000.
      expandSecondary();
      fireEvent.click(screen.getByRole("button", { name: "Watch port 7000" }));
      await waitFor(() => expect(screen.getByText("in use")).toBeTruthy());

      hoverFavouriteRow(7000);
      killShortcut();
      expect(killSpy).not.toHaveBeenCalled();

      // Leaving and returning to the tab must not resurrect the arm.
      fireEvent.click(thermalTab());
      fireEvent.click(portsTab());
      await waitFor(() => expect(screen.getByText("in use")).toBeTruthy());

      hoverFavouriteRow(7000);
      killShortcut();
      expect(killSpy).not.toHaveBeenCalled();

      killShortcut();
      expect(killSpy).toHaveBeenCalledTimes(1);
      expect(killSpy).toHaveBeenCalledWith(expect.objectContaining({ port: 7000 }));
    });

    it("a stale snapshot disables kills on favourite rows, pointer and keyboard, but not on listening rows", async () => {
      const killSpy = vi.spyOn(portsModule, "killPort");
      const listSpy = vi.spyOn(portsModule, "listPorts");
      renderApp({ retry: false });
      await waitFor(() => expect(screen.getByText("3000")).toBeTruthy());

      fireEvent.click(screen.getByRole("button", { name: "Watch port 3000" }));
      await waitFor(() => expect(screen.getByText("in use")).toBeTruthy());

      // Next poll fails: TanStack Query retains the last successful data
      // alongside the error, which `favouritesQueryHealth` reports as
      // "stale".
      listSpy.mockRejectedValueOnce(new Error("boom"));
      await waitFor(() => expect(screen.getByText(/in use · stale/)).toBeTruthy(), {
        timeout: 3000,
      });

      const killBtn = favouriteRows(3000).getByLabelText(/Cannot kill .* on port 3000/);
      expect((killBtn as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(killBtn);
      expect(killSpy).not.toHaveBeenCalled();

      hoverFavouriteRow(3000);
      killShortcut();
      expect(killSpy).not.toHaveBeenCalled();

      // The listening copy of the same process never carried that guard.
      hoverRow(3000, "Dev ports");
      killShortcut();
      expect(killSpy).toHaveBeenCalledTimes(1);
      expect(killSpy).toHaveBeenCalledWith(expect.objectContaining({ port: 3000 }));
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
      await waitFor(() => expect(screen.getByText("in use")).toBeTruthy());

      const removeBtn = screen.getByRole("button", { name: "Remove watched port 3000" });
      removeBtn.focus();
      const notPrevented = fireEvent.keyDown(removeBtn, { key: "Enter" });
      expect(notPrevented).toBe(true);
      expect(killSpy).not.toHaveBeenCalled();
      expect(screen.queryByText("PID")).toBeNull();
      expect(screen.getByText("in use")).toBeTruthy();

      // Simulate the browser's own Enter-on-button activation.
      fireEvent.click(removeBtn);
      expect(screen.queryByText("in use")).toBeNull();
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
    // Case 1: add named free port, remount.
    it("a named free-port watch survives a remount and the app still starts on Ports", async () => {
      const { unmount } = renderApp();
      await waitFor(() => expect(screen.getByText("3000")).toBeTruthy());

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
      expect(portsTab().getAttribute("aria-selected")).toBe("true");
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
      expect(favouritesHeader().textContent).toBe("FAVOURITES · 1");

      const secondListener = {
        ...MOCK_PORTS.find((e) => e.port === 3000)!,
        pid: 9101,
        startedAt: Math.floor(Date.now() / 1000) - 60,
        label: "Next.js dev (2)",
      };
      listSpy.mockResolvedValueOnce([...MOCK_PORTS, secondListener]);
      await waitFor(() => expect(devRows().getByText("Next.js dev (2)")).toBeTruthy(), {
        timeout: 3000,
      });

      // Still one saved favourite, not two.
      expect(favouritesHeader().textContent).toBe("FAVOURITES · 1");
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
      await waitFor(() => expect(screen.getByText("in use")).toBeTruthy());

      // Arm (pointer) the original incarnation (pid 4101) on its favourite
      // row — selecting it first, as a real pointer hovers before clicking.
      hoverFavouriteRow(3000);
      fireEvent.click(favouriteRows(3000).getByLabelText("Kill Next.js dev on port 3000"));
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
      // Select the (now-different-key) row first — arming requires the
      // armed row to also be the selected one (see App's disarm effect).
      hoverFavouriteRow(3000);
      fireEvent.click(favouriteRows(3000).getByLabelText("Kill Next.js dev on port 3000"));
      expect(killSpy).not.toHaveBeenCalled();
      fireEvent.click(favouriteRows(3000).getByLabelText("Kill Next.js dev on port 3000"));
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
      await waitFor(() => expect(favouriteRows(3000).getByText("Next.js dev (2)")).toBeTruthy());

      // One "in use" watch — not two.
      expect(favouritesHeader().textContent).toBe("FAVOURITES · 1");
      expect(screen.getAllByText("in use").length).toBe(1);

      const killBtns = favouriteRows(3000).getAllByLabelText(/^Kill Next\.js dev.*on port 3000$/);
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
      await waitFor(() => expect(screen.getByText("cupsd")).toBeTruthy());

      // No kill control exists for an unkillable row.
      expect(screen.queryByLabelText(/Kill cupsd/)).toBeNull();

      const lockedRow = favouriteRows(631).getByLabelText("Belongs to another user").closest("li")!;
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
      await waitFor(() => expect(screen.getByText("in use")).toBeTruthy());

      fireEvent.click(screen.getByRole("button", { name: /watch a port/i }));
      const portInput = screen.getByLabelText("Port");

      fireEvent.keyDown(portInput, { key: "ArrowDown" });
      fireEvent.keyDown(portInput, { key: "Backspace", metaKey: true });
      expect(killSpy).not.toHaveBeenCalled();
      // The form is still open (arrows/⌘⌫ did not close/expand anything).
      expect(screen.getByLabelText("Port")).toBeTruthy();

      fireEvent.keyDown(portInput, { key: "Escape" });
      // Form closed; the Favourites section (and its watched list) is
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
      await waitFor(() => expect(favouriteRows(3000).getByText("Next.js dev (2)")).toBeTruthy());

      // Match by saved name.
      fireEvent.change(searchField(), { target: { value: "Frontend" } });
      expect(favouriteRows(3000).getByText("Next.js dev")).toBeTruthy();
      expect(favouriteRows(3000).getByText("Next.js dev (2)")).toBeTruthy();
      expect(screen.queryByText("PostgreSQL")).toBeNull();

      // Match by a live field (project name) instead.
      fireEvent.change(searchField(), { target: { value: "tapuy-web" } });
      expect(favouriteRows(3000).getByText("Next.js dev")).toBeTruthy();
      expect(favouriteRows(3000).getByText("Next.js dev (2)")).toBeTruthy();

      fireEvent.change(searchField(), { target: { value: "" } });
      await waitFor(() => expect(favouriteRows(5432).getByText("PostgreSQL")).toBeTruthy());
    });

    // Case 12: kill toast copy and pending-disable behavior on favourite
    // rows match listening rows — including the rejected-IPC path.
    it("Favourites: a rejected kill shows a failure toast and the row is never left stuck disabled", async () => {
      const killSpy = vi.spyOn(portsModule, "killPort").mockRejectedValueOnce(new Error("nope"));
      renderApp();
      await waitFor(() => expect(screen.getByText("3000")).toBeTruthy());
      fireEvent.click(screen.getByRole("button", { name: "Watch port 3000" }));
      await waitFor(() => expect(screen.getByText("in use")).toBeTruthy());

      hoverFavouriteRow(3000);
      fireEvent.click(favouriteRows(3000).getByLabelText("Kill Next.js dev on port 3000"));
      fireEvent.click(screen.getByText("Kill?"));

      await waitFor(() => {
        const toast = screen.getByRole("status");
        expect(toast.textContent).toContain("Could not kill");
      });
      expect(killSpy).toHaveBeenCalledTimes(1);

      // Not stuck: a fresh arm-then-confirm still reaches killPort again.
      fireEvent.click(favouriteRows(3000).getByLabelText("Kill Next.js dev on port 3000"));
      fireEvent.click(screen.getByText("Kill?"));
      await waitFor(() => expect(killSpy).toHaveBeenCalledTimes(2));
    });

    // Case 12 (toast copy): the copy action on a stopped toast copies the
    // process's command, as for a listening row.
    it("Favourites: a stopped-process toast offers Copy command and copies it", async () => {
      vi.spyOn(portsModule, "killPort").mockResolvedValueOnce("terminated");
      const writeTextSpy = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, { clipboard: { writeText: writeTextSpy } });

      renderApp();
      await waitFor(() => expect(screen.getByText("3000")).toBeTruthy());
      fireEvent.click(screen.getByRole("button", { name: "Watch port 3000" }));
      await waitFor(() => expect(screen.getByText("in use")).toBeTruthy());

      hoverFavouriteRow(3000);
      fireEvent.click(favouriteRows(3000).getByLabelText("Kill Next.js dev on port 3000"));
      fireEvent.click(screen.getByText("Kill?"));

      await waitFor(() => expect(screen.getByRole("status")).toBeTruthy());
      fireEvent.click(screen.getByRole("button", { name: /copy command/i }));
      expect(writeTextSpy).toHaveBeenCalledWith(expect.stringContaining("next dev"));
    });
  });
});

describe("App Thermal tab", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    resetMemorySettings();
  });

  it("with defaults, the Ports tab reads no sensor and the Thermal label has no temperature", async () => {
    const current = vi.spyOn(thermalModule, "thermalCurrent");
    const history = vi.spyOn(thermalModule, "thermalHistory");
    renderApp();
    await screen.findByText("3000");
    expect(thermalTab().textContent).toBe("Thermal");
    expect(current).not.toHaveBeenCalled();
    expect(history).not.toHaveBeenCalled();
  });

  it("with the setting on, the Thermal tab label shows the temperature in its band colour", async () => {
    await setSetting("showTemperatureInPanel", true);
    renderApp();
    await waitFor(() => expect(thermalTab().textContent).toBe("Thermal58°"));
    expect(screen.getByRole("tab", { name: "Thermal 58°" })).toBeTruthy();
    const temp = within(thermalTab()).getByText("58°");
    expect(temp.getAttribute("style")).toContain("var(--pw-band-normal)");
    // Ports stays the selected tab: the label alone polls the reading.
    expect(portsTab().getAttribute("aria-selected")).toBe("true");
  });

  it("mounts ThermalPanel, and a peak's port pill switches to Ports with the search set and focused", async () => {
    vi.spyOn(thermalModule, "thermalHistory").mockResolvedValue({
      available: true,
      buckets: [],
      days: [],
      peaks: [
        {
          id: 1,
          atS: Math.floor(Date.now() / 1000),
          avgC: 92,
          maxC: 97,
          state: "fair",
          processes: [{ pid: 5101, name: "node", cpu: 180, ports: [5173] }],
        },
      ],
    });
    renderApp();
    await screen.findByText("3000");

    fireEvent.click(thermalTab());
    fireEvent.click(await screen.findByRole("button", { name: "Show port 5173" }));

    expect(portsTab().getAttribute("aria-selected")).toBe("true");
    expect(searchField().value).toBe("5173");
    expect(screen.getByText("5173")).toBeTruthy();
    expect(screen.queryByText("3000")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(searchField()));
  });

  it("the Thermal tab's footer link opens Settings on the Thermal section", async () => {
    const openSettings = vi.spyOn(portsModule, "openSettings").mockResolvedValue();
    renderApp();
    await screen.findByText("3000");

    fireEvent.click(thermalTab());
    fireEvent.click(await screen.findByRole("button", { name: "Thermal history in Settings" }));
    expect(openSettings).toHaveBeenCalledWith("thermal");
  });

  it("arrow keys and ⌘⌫ on the Thermal tab never act on a port row", async () => {
    const killSpy = vi.spyOn(portsModule, "killPort");
    renderApp();
    await screen.findByText("3000");

    fireEvent.click(thermalTab());
    fireEvent.keyDown(window, { key: "ArrowDown" });
    killShortcut();
    expect(killSpy).not.toHaveBeenCalled();
  });
});
