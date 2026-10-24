import { useQuery } from "@tanstack/react-query";
import { topProcesses } from "@/lib/machine";

/** Every call walks the process table, so this polls only while the Machine tab is open. The
 * first call after a pause is only a baseline and comes back empty, so retry sooner until
 * rows arrive. */
export function useTopProcesses(enabled: boolean) {
  return useQuery({
    queryKey: ["top"],
    queryFn: () => topProcesses(5),
    refetchInterval: (query) => (query.state.data?.length ? 2000 : 1000),
    refetchIntervalInBackground: false,
    enabled,
  });
}
