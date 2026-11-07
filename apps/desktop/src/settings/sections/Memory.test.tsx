import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import Memory from "./Memory";
import * as memory from "../../lib/memory";
import { getSetting, resetMemorySettings } from "../store";

describe("Settings > Memory", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    resetMemorySettings();
    await memory.setMemoryThresholds(memory.DEFAULT_THRESHOLDS);
  });

  it("shows the verdict, the figures and the current top processes", async () => {
    render(<Memory />);
    expect(await screen.findByText("WATCH")).toBeTruthy();
    expect(screen.getByText("21.4 GB of 24.0 GB")).toBeTruthy();
    expect(screen.getByText("zdpd")).toBeTruthy();
    expect(screen.getByText("node")).toBeTruthy();
    expect(screen.getByText("5173")).toBeTruthy();
  });

  it("shows today's chart and the last 7 days", async () => {
    render(<Memory />);
    expect(await screen.findByRole("img", { name: /Memory today/ })).toBeTruthy();
    expect(screen.getByText("Last 7 days")).toBeTruthy();
    expect(screen.getByText("95 min under pressure")).toBeTruthy();
  });

  it("says so when memory or history is unavailable", async () => {
    vi.spyOn(memory, "memoryCurrent").mockResolvedValue(null);
    vi.spyOn(memory, "memoryHistory").mockResolvedValue({
      available: false,
      buckets: [],
      days: [],
    });
    render(<Memory />);
    expect(await screen.findByText("Memory figures are unavailable.")).toBeTruthy();
    expect(await screen.findByText("History is unavailable right now.")).toBeTruthy();
  });

  it("saves the guard switch as soon as it changes", async () => {
    render(<Memory />);
    const record = screen.getByRole("switch", { name: "Record memory in the background" });
    expect(record.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(record);
    await waitFor(async () => expect(await getSetting("memoryGuardEnabled")).toBe(false));
  });

  it("starts the five thresholds at their defaults", async () => {
    render(<Memory />);
    const input = (name: string) =>
      screen.findByRole("spinbutton", { name }) as Promise<HTMLInputElement>;
    expect((await input("Watch when swap is above")).value).toBe("80");
    expect((await input("Stop when swap is above")).value).toBe("95");
    expect((await input("A process is big above")).value).toBe("25");
    expect((await input("A process is growing at")).value).toBe("2");
    expect((await input("…and only above")).value).toBe("2");
  });

  it("saves an edited threshold on blur and Reset restores the defaults", async () => {
    const save = vi.spyOn(memory, "setMemoryThresholds");
    render(<Memory />);
    const watch = (await screen.findByRole("spinbutton", {
      name: "Watch when swap is above",
    })) as HTMLInputElement;
    fireEvent.change(watch, { target: { value: "70" } });
    fireEvent.blur(watch);
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(expect.objectContaining({ swapWatchPct: 70 })),
    );
    expect(watch.value).toBe("70");

    fireEvent.click(screen.getByRole("button", { name: "Reset to defaults" }));
    await waitFor(() => expect(save).toHaveBeenLastCalledWith(memory.DEFAULT_THRESHOLDS));
    expect(watch.value).toBe("80");
  });

  it("keeps the stored value and says why when a threshold is invalid", async () => {
    const save = vi.spyOn(memory, "setMemoryThresholds");
    render(<Memory />);
    const stop = (await screen.findByRole("spinbutton", {
      name: "Stop when swap is above",
    })) as HTMLInputElement;
    fireEvent.change(stop, { target: { value: "50" } });
    fireEvent.blur(stop);
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /cannot be below the watch level/,
    );
    expect(save).not.toHaveBeenCalled();
    expect(stop.value).toBe("95");
  });
});
