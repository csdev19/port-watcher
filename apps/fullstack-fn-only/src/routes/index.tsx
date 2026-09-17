import { createFileRoute } from "@tanstack/react-router";
import { Button, Card, CardContent } from "@port-watcher/web-ui";
import { Download, Github, Search, Eye, MenuSquare, X } from "lucide-react";

export const Route = createFileRoute("/")({
  component: HomePage,
});

// TODO: point at the real uploaded build once chapay-updates.cs19.dev is live.
const DOWNLOAD_URL = "https://chapay-updates.cs19.dev/chapay.dmg";
const GITHUB_URL = "https://github.com/csdev19/port-watcher";

function HomePage() {
  return (
    <div className="min-h-screen bg-linear-to-b from-background to-muted/20">
      {/* Hero */}
      <div className="container mx-auto px-4 py-16 md:py-24">
        <div className="max-w-3xl mx-auto text-center space-y-6">
          <p className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
            Free &amp; open source · Built for macOS
          </p>
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight">
            Port in use? See what&rsquo;s running.
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Find the app and project behind a busy port. Stop the process and get back to work—all
            from your menu bar.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
            <a href={DOWNLOAD_URL}>
              <Button size="lg" className="text-lg">
                <Download className="mr-2 h-5 w-5" />
                Download for macOS
              </Button>
            </a>
            <a href={GITHUB_URL} target="_blank" rel="noreferrer">
              <Button size="lg" variant="outline" className="text-lg">
                <Github className="mr-2 h-5 w-5" />
                View on GitHub
              </Button>
            </a>
          </div>
        </div>

        <div className="mx-auto mt-16 max-w-xs">
          <PanelMockup />
        </div>
      </div>

      {/* Feature grid */}
      <div className="container mx-auto px-4 py-16">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-12">Find it. Recognize it. Stop it.</h2>

          <div className="grid md:grid-cols-3 gap-8">
            <Card>
              <CardContent className="space-y-4 p-6">
                <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Search className="h-6 w-6 text-primary" />
                </div>
                <h3 className="text-xl font-semibold">Find the busy port.</h3>
                <p className="text-muted-foreground">
                  Search by port, app, or project folder. Keep your development processes in view,
                  with apps and system services tucked away.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="space-y-4 p-6">
                <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Eye className="h-6 w-6 text-primary" />
                </div>
                <h3 className="text-xl font-semibold">Know what you&rsquo;re stopping.</h3>
                <p className="text-muted-foreground">
                  See the process and its project folder before you act. Stop the server you meant
                  to stop.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="space-y-4 p-6">
                <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
                  <MenuSquare className="h-6 w-6 text-primary" />
                </div>
                <h3 className="text-xl font-semibold">There when you need it.</h3>
                <p className="text-muted-foreground">
                  Open chapay from your menu bar. Port information refreshes while the panel is
                  open; polling pauses when you close it.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* CTA */}
      <div className="container mx-auto px-4 py-16">
        <Card className="max-w-3xl mx-auto">
          <CardContent className="text-center space-y-6 p-12">
            <h2 className="text-3xl font-bold">Ready to reclaim your ports?</h2>
            <p className="text-lg text-muted-foreground">
              Free, open source, and built for macOS — nothing to sign up for.
            </p>
            <a href={DOWNLOAD_URL}>
              <Button size="lg" className="text-lg">
                <Download className="mr-2 h-5 w-5" />
                Download for macOS
              </Button>
            </a>
          </CardContent>
        </Card>
      </div>

      {/* Footer */}
      <footer className="container mx-auto px-4 py-8 border-t">
        <div className="text-center text-sm text-muted-foreground">
          <p>chapay — Free &amp; open source, built for macOS</p>
        </div>
      </footer>
    </div>
  );
}

/** A CSS-only mock of the chapay panel, standing in for a real product
 * screenshot until one is captured. */
function PanelMockup() {
  const rows = [
    { port: "1420", label: "Tauri dev", sub: "~/dev/chapay/apps/desktop" },
    { port: "3000", label: "Next.js dev", sub: "~/dev/tapuy/apps/web" },
    { port: "5173", label: "Vite", sub: "~/dev/laqi/panel" },
  ];

  return (
    <div className="rounded-2xl border bg-neutral-950 p-3 shadow-2xl">
      <div className="flex items-center gap-2 rounded-lg bg-neutral-900 px-3 py-2 text-neutral-500">
        <Search className="h-4 w-4" />
        <span className="text-sm">Search port, app or folder</span>
      </div>
      <div className="mt-3 flex gap-4 border-b border-neutral-800 px-1 text-sm text-neutral-400">
        <span className="border-b-2 border-neutral-100 pb-2 font-medium text-neutral-100">
          Listening
        </span>
        <span className="pb-2">Favourites</span>
      </div>
      <ul className="mt-1">
        {rows.map((row) => (
          <li
            key={row.port}
            className="flex items-center gap-3 border-b border-neutral-900 px-1 py-3 last:border-none"
          >
            <span className="w-10 shrink-0 font-mono text-sm text-neutral-100">{row.port}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-neutral-100">{row.label}</span>
              <span className="block truncate text-xs text-neutral-500">{row.sub}</span>
            </span>
            <X className="h-4 w-4 shrink-0 text-neutral-700" />
          </li>
        ))}
      </ul>
    </div>
  );
}
