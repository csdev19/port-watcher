import { useQuery } from "@tanstack/react-query";
import { thermalCurrent, thermalHistory, todayRange } from "@/lib/thermal";

/** The current reading, every 10 s while the panel is visible. Only mount
 * it when the temperature is shown: an unmounted query never calls Rust. */
export function useThermalCurrent() {
  return useQuery({
    queryKey: ["thermal", "current"],
    queryFn: thermalCurrent,
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
  });
}

/** Today's buckets and peaks (local midnight to now), every 60 s while
 * mounted. The range is recomputed on each fetch so it follows midnight. */
export function useThermalToday() {
  return useQuery({
    queryKey: ["thermal", "today"],
    queryFn: () => {
      const { fromS, toS } = todayRange(new Date());
      return thermalHistory(fromS, toS, 1);
    },
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
}
