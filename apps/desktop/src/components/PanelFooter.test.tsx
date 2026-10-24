import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PanelFooter } from "./PanelFooter";

function setup(pendingUpdateVersion: string | null = null) {
  const onOpenSettings = vi.fn();
  const onQuit = vi.fn();
  render(
    <PanelFooter
      status="4 dev · 2s"
      onOpenSettings={onOpenSettings}
      onQuit={onQuit}
      pendingUpdateVersion={pendingUpdateVersion}
    />,
  );
  return { onOpenSettings, onQuit };
}

describe("PanelFooter", () => {
  it("shows Settings, the status and Quit", () => {
    setup();
    expect(screen.getByRole("button", { name: "Settings" })).toBeTruthy();
    expect(screen.getByText("4 dev · 2s")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Quit" })).toBeTruthy();
  });

  it("Settings and Quit call their handlers", () => {
    const { onOpenSettings, onQuit } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Quit" }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(onQuit).toHaveBeenCalledTimes(1);
  });

  it("an available update adds the dot and names the version, without a native title", () => {
    setup("0.3.0");
    const settings = screen.getByRole("button", { name: "Settings (chapay 0.3.0 is available)" });
    expect(screen.getByTestId("update-dot")).toBeTruthy();
    expect(settings.hasAttribute("title")).toBe(false);
  });

  it("no dot when there is no pending update", () => {
    setup();
    expect(screen.queryByTestId("update-dot")).toBeNull();
  });
});
