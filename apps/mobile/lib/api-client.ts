import { authClient } from "./auth-client";
import { env } from "./env";

type FetchOptions = {
  params?: Record<string, string | number | boolean | undefined>;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
};

export async function apiFetch<T>(endpoint: string, options: FetchOptions = {}): Promise<T> {
  const { params, method = "GET", body } = options;

  // Build URL with query params
  let url = `${env.EXPO_PUBLIC_API_URL}${endpoint}`;
  if (params) {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) {
        searchParams.append(key, String(value));
      }
    });
    const queryString = searchParams.toString();
    if (queryString) {
      url += `?${queryString}`;
    }
  }

  // Get cookies from better-auth expo client for authenticated requests
  const cookies = authClient.getCookie();
  const headers: Record<string, string> = {
    Cookie: cookies,
  };

  if (body) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    credentials: "omit", // Don't auto-include credentials, we set cookies manually
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: { message: "Request failed" } }));
    throw new Error(error.error?.message || `HTTP ${response.status}`);
  }

  return response.json();
}
