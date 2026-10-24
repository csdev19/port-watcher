import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMachine } from "./use-machine";
import { useTopProcesses } from "./use-top-processes";
import * as machine from "@/lib/machine";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("machine hooks", () => {
  afterEach(() => vi.restoreAllMocks());

  it("never call the backend while disabled", async () => {
    const snap = vi.spyOn(machine, "machineSnapshot");
    const top = vi.spyOn(machine, "topProcesses");
    renderHook(() => useMachine(false), { wrapper });
    renderHook(() => useTopProcesses(false), { wrapper });
    await new Promise((r) => setTimeout(r, 30));
    expect(snap).not.toHaveBeenCalled();
    expect(top).not.toHaveBeenCalled();
  });

  it("fetch once enabled (mock data outside Tauri)", async () => {
    const { result } = renderHook(() => useMachine(true), { wrapper });
    await waitFor(() => expect(result.current.data?.gauges).toHaveLength(4));
    const top = renderHook(() => useTopProcesses(true), { wrapper });
    await waitFor(() => expect(top.result.current.data?.length).toBeGreaterThan(0));
  });
});
