import { useQuery } from "@tanstack/react-query";
import { memoryCurrent, memoryHistory } from "@/lib/memory";
import { todayRange } from "@/lib/thermal";

/** The current reading, every 10 s while the panel is visible. Only mount
 * it when memory is shown: an unmounted query never calls Rust. */
export function useMemoryCurrent() {
  return useQuery({
    queryKey: ["memory", "current"],
    queryFn: memoryCurrent,
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
  });
}

/** Today's buckets (local midnight to now), every 60 s while mounted. The
 * range is recomputed on each fetch so it follows midnight. */
export function useMemoryToday() {
  return useQuery({
    queryKey: ["memory", "today"],
    queryFn: () => {
      const { fromS, toS } = todayRange(new Date());
      return memoryHistory(fromS, toS, 1);
    },
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
}
