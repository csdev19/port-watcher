import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import type { UpdateStatus } from "@/lib/update";
import { getSetting, resetMemorySettings } from "@/settings/store";

// The panel's side of in-app updates: the banner above the search and the
// fuchsia dot on the footer's gear. Rust's state is stubbed at the hook.
const update = vi.hoisted(() => ({
  status: { state: "idle" } as UpdateStatus,
  install: vi.fn(async () => {}),
}));
vi.mock("@/lib/update", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/update")>()),
  useUpdate: () => [
    update.status,
    { check: vi.fn(async () => {}), install: update.install, restart: vi.fn(async () => {}) },
  ],
}));

function renderApp() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <App />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  update.status = { state: "idle" };
  update.install.mockClear();
  window.localStorage.clear();
  resetMemorySettings();
});

describe("App: update notice", () => {
  it("shows no banner and no dot without an update", async () => {
    renderApp();
    await screen.findByText("3000");
    expect(screen.queryByText(/is available/)).toBeNull();
    expect(screen.queryByTestId("update-dot")).toBeNull();
    expect(screen.getByRole("button", { name: "Settings" })).toBeTruthy();
  });

  it("shows the banner and the gear dot when a newer chapay exists", async () => {
    update.status = { state: "available", version: "0.3.0" };
    renderApp();
    await screen.findByText("3000");
    expect(screen.getByText("chapay 0.3.0 is available")).toBeTruthy();
    expect(screen.getByTestId("update-dot")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Settings (chapay 0.3.0 is available)" }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Update" }));
    expect(update.install).toHaveBeenCalledTimes(1);
  });

  it("dismissing hides the banner for that version but keeps the dot", async () => {
    update.status = { state: "available", version: "0.3.0" };
    renderApp();
    await screen.findByText("3000");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss update notice" }));
    await waitFor(() => expect(screen.queryByText("chapay 0.3.0 is available")).toBeNull());
    expect(await getSetting("dismissedUpdateVersion")).toBe("0.3.0");
    expect(screen.getByTestId("update-dot")).toBeTruthy();
  });
});
