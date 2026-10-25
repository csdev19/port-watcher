import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProcessTable } from "./ProcessTable";
import { MOCK_TOP } from "@/lib/mock-machine";
import { joinPorts, type ProcessRowDto } from "@/lib/process-table";
import * as machine from "@/lib/machine";

function renderTable(rows: ProcessRowDto[], onToast = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <ProcessTable rows={rows} loading={false} error={null} cpuWarn={80} onToast={onToast} />
    </QueryClientProvider>,
  );
  return onToast;
}

const rows = joinPorts(MOCK_TOP, []).map((r, i) => (i === 0 ? { ...r, ports: [3000, 5173] } : r));

describe("ProcessTable", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows CPU, GPU, memory and ports, with a dash where there is no figure", () => {
    renderTable(rows);
    const all = screen.getAllByTestId("process-row");
    const cursor = within(all[0]!);
    expect(cursor.getByText("22%")).toBeTruthy();
    expect(cursor.getByText("8.4%")).toBeTruthy();
    expect(cursor.getByText(":3000")).toBeTruthy();
    expect(cursor.getByText(":5173")).toBeTruthy();
    const node = within(all[1]!);
    expect(node.getByLabelText("not available")).toBeTruthy();
    expect(node.getByLabelText("no listening ports")).toBeTruthy();
  });

  it("kills a row only on the second click, through kill_process for its target", async () => {
    const kill = vi.spyOn(machine, "killProcess").mockResolvedValue("terminated");
    const onToast = renderTable(rows);
    const button = screen.getByRole("button", { name: "Kill Cursor" });
    fireEvent.click(button);
    expect(kill).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm: kill Cursor" }));
    await waitFor(() => expect(kill).toHaveBeenCalledTimes(1));
    expect(kill).toHaveBeenCalledWith({ pid: 4101, startedAt: 1_700_000_001 });
    await waitFor(() =>
      expect(onToast).toHaveBeenCalledWith({
        message: "Cursor stopped",
        command: null,
      }),
    );
  });

  it("a locked row has a lock with its reason and no kill button", () => {
    renderTable(rows);
    const ws = screen.getAllByTestId("process-row")[3]!;
    expect(within(ws).queryByRole("button")).toBeNull();
    expect(within(ws).getByLabelText("macOS system process")).toBeTruthy();
  });

  it("explains an empty table", () => {
    const client = new QueryClient();
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <ProcessTable rows={[]} loading error={null} cpuWarn={null} onToast={() => {}} />
      </QueryClientProvider>,
    );
    expect(screen.getByText("collecting…")).toBeTruthy();
    rerender(
      <QueryClientProvider client={client}>
        <ProcessTable rows={[]} loading={false} error="boom" cpuWarn={null} onToast={() => {}} />
      </QueryClientProvider>,
    );
    expect(screen.getByText("Could not read processes: boom")).toBeTruthy();
  });
});
