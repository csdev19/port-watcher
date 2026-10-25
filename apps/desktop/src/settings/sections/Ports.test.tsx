import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import Ports from "./Ports";
import { resetFavouritesMigration } from "../../lib/favourites-migration";
import { FAVOURITES_STORAGE_KEY } from "../../lib/favourites";
import { getSetting, resetMemorySettings, setSetting } from "../store";

const native = vi.hoisted(() => ({
  setAlertRuleEnabled: vi.fn<(rule: string, on: boolean) => Promise<void>>(),
}));
vi.mock("../native", () => native);

async function seed(items: { port: number; name?: string }[]) {
  await setSetting("favourites", items);
}

describe("Settings > Ports", () => {
  afterEach(() => {
    window.localStorage.clear();
    resetMemorySettings();
    resetFavouritesMigration();
    vi.clearAllMocks();
  });

  it("saves the two list switches as soon as they change", async () => {
    render(<Ports />);
    fireEvent.click(screen.getByRole("switch", { name: "Confirm before kill" }));
    fireEvent.click(screen.getByRole("switch", { name: "Show apps & system" }));
    expect(await getSetting("confirmBeforeKill")).toBe(false);
    expect(await getSetting("showAppsAndSystem")).toBe(false);
  });

  it("the notify switch is off by default and turns the watched-port rule on through Rust", async () => {
    native.setAlertRuleEnabled.mockResolvedValue();
    render(<Ports />);
    const notify = screen.getByRole("switch", { name: /Notify when a watched port is taken/ });
    expect((notify as HTMLButtonElement).disabled).toBe(false);
    expect(notify.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(notify);
    expect(native.setAlertRuleEnabled).toHaveBeenCalledExactlyOnceWith("watchedPortTaken", true);
  });

  it("a refused rule change leaves the switch where it was and says so", async () => {
    native.setAlertRuleEnabled.mockRejectedValue(new Error("engine is not running"));
    render(<Ports />);
    const notify = screen.getByRole("switch", { name: /Notify when a watched port is taken/ });
    fireEvent.click(notify);
    await waitFor(() => expect(screen.getByText(/Couldn't turn this alert on/)).toBeTruthy());
    expect(notify.getAttribute("aria-checked")).toBe("false");
  });

  it("lists watched ports with in use / free, and the listener label when unnamed", async () => {
    // Mock snapshot (outside Tauri): 3000 is listening, 4321 is not.
    await seed([{ port: 3000 }, { port: 4321, name: "Storybook" }]);
    render(<Ports />);
    await waitFor(() => expect(screen.getByText("Watched ports · 2")).toBeTruthy());
    await waitFor(() => expect(screen.getByText("in use")).toBeTruthy());
    expect(screen.getByText("free")).toBeTruthy();
    expect(screen.getByText("Storybook")).toBeTruthy();
    expect(screen.getByText("Next.js dev")).toBeTruthy();
  });

  it("imports the old localStorage list once and keeps the old key", async () => {
    const legacy = JSON.stringify([{ port: 3000 }]);
    window.localStorage.setItem(FAVOURITES_STORAGE_KEY, legacy);
    render(<Ports />);
    await waitFor(() => expect(screen.getByText("Watched ports · 1")).toBeTruthy());
    expect(await getSetting("favourites")).toEqual([{ port: 3000 }]);
    expect(window.localStorage.getItem(FAVOURITES_STORAGE_KEY)).toBe(legacy);
  });

  it("unwatches a port and persists it in settings", async () => {
    await seed([{ port: 3000 }]);
    render(<Ports />);
    await waitFor(() => expect(screen.getByText("Watched ports · 1")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Stop watching port 3000" }));
    expect(screen.getByText("Watched ports · 0")).toBeTruthy();
    await waitFor(async () => expect(await getSetting("favourites")).toEqual([]));
  });

  it("adds a port with Enter; Watch stays disabled until the input is valid", async () => {
    render(<Ports />);
    const input = screen.getByLabelText("Port to watch");
    const watch = screen.getByRole("button", { name: "Watch" }) as HTMLButtonElement;
    expect(watch.disabled).toBe(true);
    fireEvent.change(input, { target: { value: "70000" } });
    expect(watch.disabled).toBe(true);
    fireEvent.change(input, { target: { value: "4321" } });
    expect(watch.disabled).toBe(false);
    fireEvent.submit(input.closest("form")!);
    expect(screen.getByText("Watched ports · 1")).toBeTruthy();
    expect((input as HTMLInputElement).value).toBe("");
    await waitFor(async () => expect(await getSetting("favourites")).toEqual([{ port: 4321 }]));
  });

  it("shows the duplicate message instead of adding twice", async () => {
    await seed([{ port: 4321 }]);
    render(<Ports />);
    await waitFor(() => expect(screen.getByText("Watched ports · 1")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Port to watch"), { target: { value: "4321" } });
    fireEvent.click(screen.getByRole("button", { name: "Watch" }));
    expect(screen.getByRole("alert").textContent).toBe("Port 4321 is already watched");
    expect(screen.getByText("Watched ports · 1")).toBeTruthy();
  });

  it("picks up an edit made in the other window", async () => {
    render(<Ports />);
    await act(async () => {
      await seed([{ port: 5173 }]);
    });
    expect(screen.getByText("Watched ports · 1")).toBeTruthy();
  });
});
