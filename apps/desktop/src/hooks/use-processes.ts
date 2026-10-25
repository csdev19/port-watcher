import { useQuery } from "@tanstack/react-query";
import { topProcesses } from "@/lib/machine";

/** The full window's process table: up to 50 app groups, every 2 s. The first call after a
 * pause is only a baseline and comes back empty, so retry sooner until rows arrive. */
export function useProcesses() {
  return useQuery({
    queryKey: ["processes"],
    queryFn: () => topProcesses(50),
    refetchInterval: (query) => (query.state.data?.length ? 2000 : 1000),
    refetchIntervalInBackground: false,
  });
}
