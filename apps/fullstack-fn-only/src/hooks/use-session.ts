import { authClient } from "@/lib/auth/auth-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

export const sessionKeys = {
  all: ["auth"] as const,
  session: () => [...sessionKeys.all, "session"] as const,
};

export const useSession = () => {
  const {
    data: session,
    isPending,
    error,
    refetch,
  } = useQuery({
    queryKey: sessionKeys.session(),
    queryFn: async () => {
      const { data, error } = await authClient.getSession();

      if (error || !data) {
        return null;
      }

      return data;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: true,
  });

  return { session, isPending, error, refetch };
};

export const useSignOut = () => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  return useMutation({
    mutationFn: async () => {
      await authClient.signOut();
    },
    onSuccess: () => {
      // Clear session cache
      queryClient.setQueryData(sessionKeys.session(), null);
      queryClient.invalidateQueries({ queryKey: sessionKeys.all });
      navigate({ to: "/" });
    },
  });
};

// Helper to invalidate session (call when backend returns 401)
export const useInvalidateSession = () => {
  const queryClient = useQueryClient();

  return () => {
    queryClient.setQueryData(sessionKeys.session(), null);
    queryClient.invalidateQueries({ queryKey: sessionKeys.all });
  };
};
