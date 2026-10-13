import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UpdateStatus } from "@/lib/update";
import About from "./About";

const { invoke, getVersion, openUrl, listen, emit } = vi.hoisted(() => {
  let handler: ((event: { payload: unknown }) => void) | undefined;
  return {
    invoke: vi.fn(),
    getVersion: vi.fn(),
    openUrl: vi.fn(),
    listen: vi.fn(async (_event: string, h: (event: { payload: unknown }) => void) => {
      handler = h;
      return () => {};
    }),
    emit: (payload: unknown) => handler?.({ payload }),
  };
});

vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion }));
vi.mock("@tauri-apps/api/event", () => ({ listen }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));

const REPO = "https://github.com/csdev19/port-watcher";

/** Answers the update commands with the given statuses. */
function commands(answers: Partial<Record<string, UpdateStatus>>) {
  invoke.mockImplementation(async (cmd: string) => {
    if (cmd === "app_arch") return "Apple silicon";
    if (cmd === "update_restart") return undefined;
    if (cmd in answers) return answers[cmd];
    throw new Error(`unexpected ${cmd}`);
  });
}

async function renderAbout() {
  render(<About />);
  await screen.findByText(/v0\.3\.0/);
}

beforeEach(() => {
  vi.stubGlobal("__COMMIT__", "abc1234");
  invoke.mockReset();
  listen.mockClear();
  getVersion.mockReset().mockResolvedValue("0.3.0");
  openUrl.mockReset().mockResolvedValue(undefined);
  commands({ update_status: { state: "idle" } });
});

describe("About", () => {
  it("shows version, commit and architecture", async () => {
    await renderAbout();
    expect(screen.getByText("v0.3.0 · abc1234 · Apple silicon")).toBeTruthy();
    expect(screen.getByText(/A Niway product · built by csdev · GPL-3.0/)).toBeTruthy();
  });

  it("reports the latest version", async () => {
    commands({ update_status: { state: "idle" }, update_check: { state: "upToDate" } });
    await renderAbout();
    fireEvent.click(await screen.findByRole("button", { name: /check for updates/i }));
    expect(await screen.findByText("You're on the latest version.")).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith("update_check");
  });

  it("checks, updates with progress, then offers the restart", async () => {
    commands({
      update_status: { state: "idle" },
      update_check: { state: "available", version: "0.4.0" },
      update_install: { state: "ready", version: "0.4.0" },
    });
    await renderAbout();
    fireEvent.click(screen.getByRole("button", { name: /check for updates/i }));
    expect(await screen.findByText("chapay 0.4.0 is available.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Update to 0.4.0" }));
    expect(invoke).toHaveBeenCalledWith("update_install");
    act(() =>
      emit({ state: "downloading", version: "0.4.0", downloaded: 1_400_000, total: 2_200_000 }),
    );
    expect(screen.getByText("Downloading 1.4 / 2.2 MB")).toBeTruthy();
    expect((screen.getByRole("button", { name: /updating/i }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    fireEvent.click(await screen.findByRole("button", { name: /restart chapay/i }));
    expect(screen.getByText("0.4.0 is installed. Restart chapay to finish.")).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith("update_restart");
  });

  it("shows the state Rust already has when Settings opens", async () => {
    commands({ update_status: { state: "available", version: "0.4.0" } });
    await renderAbout();
    expect(await screen.findByRole("button", { name: "Update to 0.4.0" })).toBeTruthy();
  });

  it("says so when the check fails", async () => {
    commands({
      update_status: { state: "idle" },
      update_check: { state: "checkFailed", reason: "network" },
    });
    await renderAbout();
    fireEvent.click(screen.getByRole("button", { name: /check for updates/i }));
    expect(await screen.findByText("Couldn't check for updates.")).toBeTruthy();
  });

  it("refuses an update not signed by chapay's developer, inline, with a download fallback", async () => {
    commands({
      update_status: { state: "installFailed", version: "0.4.0", reason: "developerId" },
    });
    await renderAbout();
    expect(await screen.findByText("This update isn't signed by chapay's developer.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /download instead/i }));
    expect(openUrl).toHaveBeenCalledWith(`${REPO}/releases/tag/desktop-v0.4.0`);
  });

  it("asks to move chapay to Applications when it runs from a read-only copy", async () => {
    commands({ update_status: { state: "cannotInstallHere", version: "0.4.0" } });
    await renderAbout();
    expect(await screen.findByText("Move chapay to Applications to update in place.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^download$/i }));
    expect(openUrl).toHaveBeenCalledWith(`${REPO}/releases/tag/desktop-v0.4.0`);
  });

  it("disables the check in a build without updates", async () => {
    commands({ update_status: { state: "disabled" } });
    await renderAbout();
    expect(await screen.findByText("Updates are off in this build.")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: /check for updates/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("opens the repository and the running version's release page", async () => {
    await renderAbout();
    fireEvent.click(screen.getByRole("button", { name: /source/i }));
    expect(openUrl).toHaveBeenLastCalledWith(REPO);
    fireEvent.click(screen.getByRole("button", { name: /release notes/i }));
    expect(openUrl).toHaveBeenLastCalledWith(`${REPO}/releases/tag/desktop-v0.3.0`);
  });
});
