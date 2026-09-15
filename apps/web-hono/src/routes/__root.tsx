import type { QueryClient } from "@tanstack/react-query";

import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { HeadContent, Outlet, Scripts, createRootRouteWithContext } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";

import { Toaster } from "@monorepo-template/web-ui";

import Header from "../components/header";
import appCss from "../index.css?url";
import { getAuthSession } from "@/lib/auth/get-auth-session";
import type { AuthSession } from "@/lib/auth/types";

export interface RouterAppContext {
  queryClient: QueryClient;
  isAuthenticated: boolean;
  session: AuthSession | null;
}

export const Route = createRootRouteWithContext<RouterAppContext>()({
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "Monorepo Template",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  component: RootDocument,
  staleTime: 10 * 60 * 1000, // 10 minutes
  beforeLoad: async () => {
    const session = await getAuthSession();
    return {
      session: session ?? null,
      isAuthenticated: !!session,
    };
  },
});

// Critical inline styles to prevent flash of unstyled content
const criticalStyles = `
  html, body {
    background-color: oklch(14.5% 0 0);
    color: oklch(98.5% 0 0);
    margin: 0;
    padding: 0;
  }
`;

function RootDocument() {
  const context = Route.useRouteContext();
  const { isAuthenticated, session } = context;

  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <style dangerouslySetInnerHTML={{ __html: criticalStyles }} />
        <HeadContent />
      </head>
      <body suppressHydrationWarning>
        <div className="min-h-svh">
          <Header
            isAuthenticated={isAuthenticated}
            userName={session?.user?.name ?? ""}
            userEmail={session?.user?.email ?? ""}
          />
          <main className="pt-12">
            <Outlet />
          </main>
        </div>
        <Toaster richColors />
        <TanStackRouterDevtools position="bottom-left" />
        <ReactQueryDevtools position="bottom" buttonPosition="bottom-right" />
        <Scripts />
      </body>
    </html>
  );
}
