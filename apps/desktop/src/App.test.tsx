import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App";
import { MOCK_PORTS } from "@/lib/mock-ports";

/** jsdom has no __TAURI_INTERNALS__, so `inTauri` is false and the app
 * renders MOCK_PORTS with zero Tauri mocking — this is the whole point
 * of the `inTauri` split. This test covers the composed flow that no
 * individual component test exercises: data load, search, kill confirm,
 * and clearing a filtered-empty state. */
function renderApp() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  );
}

describe("App", () => {
  it("renders all mock ports once the initial fetch resolves", async () => {
    renderApp();
    await waitFor(() => {
      for (const entry of MOCK_PORTS) {
        expect(screen.getByText(String(entry.port))).toBeTruthy();
      }
    });
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

  it("kill requires arm-then-confirm and shows a stopped toast", async () => {
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

    expect(screen.getByText("No match")).toBeTruthy();
    fireEvent.click(screen.getByText("Clear search"));

    await waitFor(() => {
      for (const entry of MOCK_PORTS) {
        expect(screen.getByText(String(entry.port))).toBeTruthy();
      }
    });
  });
});
