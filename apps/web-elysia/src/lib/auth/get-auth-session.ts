import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { API_URL } from "@/lib/constants";
import { apiFetch } from "@/lib/api-fetch";
import type { AuthSession } from "./types";

export const getAuthSession = createServerFn({ method: "GET" }).handler(
  async (): Promise<AuthSession | null> => {
    const headers = getRequestHeaders();
    const cookie = headers.get("cookie") ?? "";

    if (!cookie) return null;

    try {
      const response = await apiFetch(`${API_URL}/api/auth/get-session`, {
        headers: { cookie },
      });

      if (!response.ok) return null;

      const data = await response.json();
      return data as AuthSession;
    } catch (error) {
      console.error("[auth] Failed to get session:", error);
      return null;
    }
  },
);
