import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";

vi.mock("./full/FullWindow", () => ({ default: () => <div>full-window</div> }));
vi.mock("./App", () => ({ default: () => <div>panel</div> }));

async function bootWith(search: string) {
  window.history.pushState({}, "", `/${search}`);
  document.body.innerHTML = '<div id="root"></div>';
  vi.resetModules();
  await import("./main");
}

describe("main routing", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    window.history.pushState({}, "", "/");
  });

  it("?view=full renders the lazy full window", async () => {
    await bootWith("?view=full");
    await waitFor(() => expect(screen.getByText("full-window")).toBeTruthy());
    expect(document.documentElement.dataset.window).toBe("full");
  });

  it("no view renders the panel", async () => {
    await bootWith("");
    await waitFor(() => expect(screen.getByText("panel")).toBeTruthy());
    expect(document.documentElement.dataset.window).toBe("panel");
  });
});
