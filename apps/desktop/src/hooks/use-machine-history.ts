import { useQuery } from "@tanstack/react-query";
import { machineHistory } from "@/lib/machine";
import type { Metric, Range } from "@/lib/machine-types";

/** One metric over a range, refetched at 1 Hz while the window is visible. Rust shares the
 * 900 ms sample throttle with the gauges, so this never doubles the sampling cost. */
export function useMachineHistory(metric: Metric, range: Range, enabled = true) {
  return useQuery({
    queryKey: ["machine-history", metric, range],
    queryFn: () => machineHistory(metric, range),
    refetchInterval: 1000,
    refetchIntervalInBackground: false,
    enabled,
  });
}
