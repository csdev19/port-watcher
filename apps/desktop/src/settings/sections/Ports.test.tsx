import { afterEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import Ports from "./Ports";
import { FAVOURITES_STORAGE_KEY } from "../../lib/favourites";
import { getSetting, resetMemorySettings } from "../store";

function seed(items: { port: number; name?: string }[]) {
  window.localStorage.setItem(FAVOURITES_STORAGE_KEY, JSON.stringify(items));
}

describe("Settings > Ports", () => {
  afterEach(() => {
    window.localStorage.clear();
    resetMemorySettings();
  });

  it("saves the two list switches as soon as they change", async () => {
    render(<Ports />);
    fireEvent.click(screen.getByRole("switch", { name: "Confirm before kill" }));
    fireEvent.click(screen.getByRole("switch", { name: "Show apps & system" }));
    expect(await getSetting("confirmBeforeKill")).toBe(false);
    expect(await getSetting("showAppsAndSystem")).toBe(false);
  });

  it("renders the v0.2 notify switch disabled and off", () => {
    render(<Ports />);
    const notify = screen.getByRole("switch", { name: /Notify when a watched port is taken/ });
    expect((notify as HTMLButtonElement).disabled).toBe(true);
    expect(notify.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText("v0.2")).toBeTruthy();
  });

  it("lists watched ports with in use / free, and the listener label when unnamed", async () => {
    // Mock snapshot (outside Tauri): 3000 is listening, 4321 is not.
    seed([{ port: 3000 }, { port: 4321, name: "Storybook" }]);
    render(<Ports />);
    expect(screen.getByText("Watched ports · 2")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("in use")).toBeTruthy());
    expect(screen.getByText("free")).toBeTruthy();
    expect(screen.getByText("Storybook")).toBeTruthy();
    expect(screen.getByText("Next.js dev")).toBeTruthy();
  });

  it("unwatches a port and persists it", () => {
    seed([{ port: 3000 }]);
    render(<Ports />);
    fireEvent.click(screen.getByRole("button", { name: "Stop watching port 3000" }));
    expect(screen.getByText("Watched ports · 0")).toBeTruthy();
    expect(JSON.parse(window.localStorage.getItem(FAVOURITES_STORAGE_KEY)!)).toEqual([]);
  });

  it("adds a port with Enter; Watch stays disabled until the input is valid", () => {
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
    expect(JSON.parse(window.localStorage.getItem(FAVOURITES_STORAGE_KEY)!)).toEqual([
      { port: 4321 },
    ]);
  });

  it("shows the duplicate message instead of adding twice", () => {
    seed([{ port: 4321 }]);
    render(<Ports />);
    fireEvent.change(screen.getByLabelText("Port to watch"), { target: { value: "4321" } });
    fireEvent.click(screen.getByRole("button", { name: "Watch" }));
    expect(screen.getByRole("alert").textContent).toBe("Port 4321 is already watched");
    expect(screen.getByText("Watched ports · 1")).toBeTruthy();
  });

  it("picks up an edit made in the other window", () => {
    render(<Ports />);
    act(() => {
      seed([{ port: 5173 }]);
      window.dispatchEvent(new StorageEvent("storage", { key: FAVOURITES_STORAGE_KEY }));
    });
    expect(screen.getByText("Watched ports · 1")).toBeTruthy();
  });
});
