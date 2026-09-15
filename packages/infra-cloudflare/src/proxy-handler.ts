export interface ProxyOptions {
  backendUrl: string;
  fetchFn: (request: Request) => Promise<Response>;
  forwardedHeaders?: boolean;
  logPrefix?: string;
}

/**
 * General API proxy that forwards requests to the backend.
 *
 * This ensures the browser always talks to the web Worker domain,
 * so auth cookies (set on this domain) are included automatically.
 * The Service Binding routes requests directly to the API Worker.
 */
export function createProxyHandler(options: ProxyOptions): (request: Request) => Promise<Response> {
  const { backendUrl, fetchFn, forwardedHeaders = false, logPrefix = "proxy" } = options;

  return async (request: Request): Promise<Response> => {
    try {
      const url = new URL(request.url);
      const targetUrl = `${backendUrl}${url.pathname}${url.search}`;
      const proxiedRequest = new Request(targetUrl, request);

      if (forwardedHeaders) {
        proxiedRequest.headers.set("x-forwarded-host", url.host);
        proxiedRequest.headers.set("x-forwarded-proto", url.protocol.replace(":", ""));
      }

      const response = await fetchFn(proxiedRequest);
      const responseHeaders = new Headers(response.headers);

      const setCookies = response.headers.getSetCookie?.() ?? [];
      if (setCookies.length > 0) {
        responseHeaders.delete("set-cookie");
        for (const cookie of setCookies) {
          responseHeaders.append("set-cookie", cookie.replace(/;\s*domain=[^;]*/gi, ""));
        }
      }

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
    } catch (error) {
      console.error(`[${logPrefix}] ERROR:`, error instanceof Error ? error.message : error);
      return new Response("Internal Server Error", { status: 500 });
    }
  };
}
