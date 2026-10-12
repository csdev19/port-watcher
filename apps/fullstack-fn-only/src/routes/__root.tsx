import type { QueryClient } from "@tanstack/react-query";

import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  useRouterState,
} from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";

import { Toaster } from "@port-watcher/web-ui";

// Auth is disabled for now (see vite.config.ts). Restore these imports, the
// context fields and `beforeLoad` below together with the auth routes.
// import Header from "../components/header";
import appCss from "../index.css?url";
// import { getAuthSession } from "@/lib/auth/get-auth-session";
// import type { AuthSession } from "@/lib/auth/types";

export interface RouterAppContext {
  queryClient: QueryClient;
  // isAuthenticated: boolean;
  // session: AuthSession | null;
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
        title: "chapay — port watcher",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      // The app icon, resized from apps/desktop/src-tauri/icons/icon.png.
      { rel: "icon", href: "/favicon.ico", sizes: "48x48" },
      { rel: "icon", type: "image/png", href: "/favicon-32x32.png", sizes: "32x32" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
    ],
  }),
  component: RootDocument,
  // staleTime: 10 * 60 * 1000, // 10 minutes
  // beforeLoad: async () => {
  //   const session = await getAuthSession();
  //   return {
  //     session: session ?? null,
  //     isAuthenticated: !!session,
  //   };
  // },
});

// Critical inline styles to prevent flash of unstyled content, matched to
// whichever theme the current route renders in (the marketing homepage is
// deliberately light; the authenticated app is dark).
const criticalStylesDark = `
  html, body {
    background-color: oklch(14.5% 0 0);
    color: oklch(98.5% 0 0);
    margin: 0;
    padding: 0;
  }
`;
const criticalStylesLight = `
  html, body {
    background-color: oklch(1 0 0);
    color: oklch(0.145 0 0);
    margin: 0;
    padding: 0;
  }
`;

function RootDocument() {
  // const context = Route.useRouteContext();
  // const { isAuthenticated, session } = context;
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // The marketing homepage is its own light, chrome-free page — no app
  // header/Sign In, no dark theme forced by the authenticated app shell.
  const isMarketing = pathname === "/";

  return (
    <html lang="en" className={isMarketing ? undefined : "dark"} suppressHydrationWarning>
      <head>
        <style
          dangerouslySetInnerHTML={{
            __html: isMarketing ? criticalStylesLight : criticalStylesDark,
          }}
        />
        <HeadContent />
      </head>
      <body suppressHydrationWarning>
        <div className="min-h-svh">
          {isMarketing ? (
            <Outlet />
          ) : (
            <>
              {/* <Header
                isAuthenticated={isAuthenticated}
                userName={session?.user?.name ?? ""}
                userEmail={session?.user?.email ?? ""}
              /> */}
              <main className="pt-12">
                <Outlet />
              </main>
            </>
          )}
        </div>
        <Toaster richColors />
        <TanStackRouterDevtools position="bottom-left" />
        <ReactQueryDevtools position="bottom" buttonPosition="bottom-right" />
        <Scripts />
      </body>
    </html>
  );
}
