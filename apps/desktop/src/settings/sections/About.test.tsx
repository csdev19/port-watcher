import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import About from "./About";

const { invoke, getVersion, openUrl } = vi.hoisted(() => ({
  invoke: vi.fn(),
  getVersion: vi.fn(),
  openUrl: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));

const REPO = "https://github.com/csdev19/port-watcher";

beforeEach(() => {
  vi.stubGlobal("__COMMIT__", "abc1234");
  invoke.mockReset();
  getVersion.mockReset().mockResolvedValue("0.3.0");
  openUrl.mockReset().mockResolvedValue(undefined);
  invoke.mockImplementation(async (cmd: string) => {
    if (cmd === "app_arch") return "Apple silicon";
    throw new Error(`unexpected ${cmd}`);
  });
});

describe("About", () => {
  it("shows version, commit and architecture", async () => {
    render(<About />);
    expect(await screen.findByText("v0.3.0 · abc1234 · Apple silicon")).toBeTruthy();
    expect(screen.getByText(/A Niway product · built by csdev · GPL-3.0/)).toBeTruthy();
  });

  it("reports the latest version", async () => {
    invoke.mockImplementation(async (cmd: string) =>
      cmd === "check_for_update" ? { status: "latest" } : "Intel",
    );
    render(<About />);
    await screen.findByText(/v0\.3\.0/);
    fireEvent.click(screen.getByRole("button", { name: /check for updates/i }));
    expect(await screen.findByText("You're on the latest version.")).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith("check_for_update", { current: "0.3.0" });
  });

  it("offers the download when a newer release exists", async () => {
    const url = `${REPO}/releases/tag/desktop-v0.4.0`;
    invoke.mockImplementation(async (cmd: string) =>
      cmd === "check_for_update" ? { status: "available", version: "0.4.0", url } : "Intel",
    );
    render(<About />);
    await screen.findByText(/v0\.3\.0/);
    fireEvent.click(screen.getByRole("button", { name: /check for updates/i }));
    expect(await screen.findByText("chapay 0.4.0 is available.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /download/i }));
    expect(openUrl).toHaveBeenCalledWith(url);
  });

  it("says so when the check fails", async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "check_for_update") throw new Error("offline");
      return "Intel";
    });
    render(<About />);
    await screen.findByText(/v0\.3\.0/);
    fireEvent.click(screen.getByRole("button", { name: /check for updates/i }));
    expect(await screen.findByText("Couldn't check for updates.")).toBeTruthy();
  });

  it("opens the repository and the running version's release page", async () => {
    render(<About />);
    await screen.findByText(/v0\.3\.0/);
    fireEvent.click(screen.getByRole("button", { name: /source/i }));
    expect(openUrl).toHaveBeenLastCalledWith(REPO);
    fireEvent.click(screen.getByRole("button", { name: /release notes/i }));
    expect(openUrl).toHaveBeenLastCalledWith(`${REPO}/releases/tag/desktop-v0.3.0`);
  });
});
