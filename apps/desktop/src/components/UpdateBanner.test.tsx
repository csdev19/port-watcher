import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { UpdateActions, UpdateStatus } from "@/lib/update";
import { UpdateBanner } from "./UpdateBanner";

function setup(status: UpdateStatus, dismissedVersion = "") {
  const actions: UpdateActions = {
    check: vi.fn(async () => {}),
    install: vi.fn(async () => {}),
    restart: vi.fn(async () => {}),
  };
  const onDismiss = vi.fn();
  const view = render(
    <UpdateBanner
      status={status}
      actions={actions}
      dismissedVersion={dismissedVersion}
      onDismiss={onDismiss}
    />,
  );
  return { actions, onDismiss, view };
}

describe("UpdateBanner", () => {
  it("offers the update with one click to install it", () => {
    const { actions } = setup({ state: "available", version: "0.3.0" });
    expect(screen.getByText("chapay 0.3.0 is available")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Update" }));
    expect(actions.install).toHaveBeenCalledTimes(1);
  });

  it("remembers a dismissal for that version only", () => {
    const { onDismiss, view } = setup({ state: "available", version: "0.3.0" });
    fireEvent.click(screen.getByRole("button", { name: "Dismiss update notice" }));
    expect(onDismiss).toHaveBeenCalledWith("0.3.0");

    view.unmount();
    setup({ state: "available", version: "0.3.0" }, "0.3.0");
    expect(screen.queryByRole("status")).toBeNull();

    setup({ state: "available", version: "0.3.1" }, "0.3.0");
    expect(screen.getByText("chapay 0.3.1 is available")).toBeTruthy();
  });

  it("shows download progress without any action", () => {
    setup({ state: "downloading", version: "0.3.0", downloaded: 1_100_000, total: 2_200_000 });
    expect(screen.getByText("Updating to 0.3.0… 50%")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("asks for the restart once installed, even after a dismissal", () => {
    const { actions } = setup({ state: "ready", version: "0.3.0" }, "0.3.0");
    expect(screen.getByText("chapay 0.3.0 is ready")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Restart to update" }));
    expect(actions.restart).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Dismiss update notice" })).toBeNull();
  });

  it("explains a failed install and offers a retry", () => {
    const { actions } = setup({ state: "installFailed", version: "0.3.0", reason: "signature" });
    expect(screen.getByText("The update failed its signature check.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(actions.install).toHaveBeenCalledTimes(1);
  });

  it("asks to move chapay when it cannot replace itself", () => {
    setup({ state: "cannotInstallHere", version: "0.3.0" });
    expect(screen.getByText("Move chapay to Applications to update.")).toBeTruthy();
  });

  it.each<UpdateStatus>([
    { state: "disabled" },
    { state: "idle" },
    { state: "checking" },
    { state: "upToDate" },
    { state: "checkFailed", reason: "network" },
  ])("stays hidden when there is nothing to offer ($state)", (status) => {
    setup(status);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
