import { useQuery } from "@tanstack/react-query";
import { thermalCurrent } from "@/lib/thermal";

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
