import { createFileRoute, Link } from "@tanstack/react-router";
import { Button, Card, CardContent } from "@monorepo-template/web-ui";
import { CheckCircle2, ArrowRight, Layers, Shield, Smartphone } from "lucide-react";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  const context = Route.useRouteContext();
  const { isAuthenticated } = context;

  return (
    <div className="min-h-screen bg-linear-to-b from-background to-muted/20">
      {/* Hero Section */}
      <div className="container mx-auto px-4 py-16 md:py-24">
        <div className="max-w-4xl mx-auto text-center space-y-8">
          <div className="space-y-4">
            <h1 className="text-4xl md:text-6xl font-bold tracking-tight">
              Monorepo Template
              <span className="block text-primary mt-2">Built for Scale</span>
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              A production-ready monorepo with DDD + Hexagonal Architecture, authentication,
              deployment configs, and a Todo CRUD example to get you started.
            </p>
            <div className="flex flex-wrap gap-2 justify-center pt-2">
              {[
                "Hono",
                "oRPC",
                "TanStack Start",
                "Better Auth",
                "Drizzle",
                "Cloudflare Workers",
              ].map((tech) => (
                <span
                  key={tech}
                  className="px-3 py-1 text-xs font-medium rounded-full bg-muted text-muted-foreground border"
                >
                  {tech}
                </span>
              ))}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
            {isAuthenticated ? (
              <Link to="/todos">
                <Button size="lg" className="text-lg">
                  Go to Dashboard <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
              </Link>
            ) : (
              <>
                <Link to="/auth/signup">
                  <Button size="lg" className="text-lg">
                    Get Started <ArrowRight className="ml-2 h-5 w-5" />
                  </Button>
                </Link>
                <Link to="/auth/login">
                  <Button size="lg" variant="outline" className="text-lg">
                    Sign In
                  </Button>
                </Link>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Features Section */}
      <div className="container mx-auto px-4 py-16">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-12">
            Everything You Need to Build Fast
          </h2>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            <Card>
              <CardContent className="space-y-4 p-6">
                <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Layers className="h-6 w-6 text-primary" />
                </div>
                <h3 className="text-xl font-semibold">DDD + Hexagonal Architecture</h3>
                <p className="text-muted-foreground">
                  Clean layer separation with domain, application, and infrastructure packages.
                  Dependency inversion built in.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="space-y-4 p-6">
                <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Shield className="h-6 w-6 text-primary" />
                </div>
                <h3 className="text-xl font-semibold">Authentication Ready</h3>
                <p className="text-muted-foreground">
                  Better Auth with email/password, session management, and auth guards
                  pre-configured across web and mobile.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="space-y-4 p-6">
                <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Smartphone className="h-6 w-6 text-primary" />
                </div>
                <h3 className="text-xl font-semibold">Web + Mobile</h3>
                <p className="text-muted-foreground">
                  TanStack Start for web with Hono + oRPC API (SSR on Cloudflare Workers) and Expo
                  for React Native mobile, sharing domain logic.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="space-y-4 p-6">
                <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
                  <CheckCircle2 className="h-6 w-6 text-primary" />
                </div>
                <h3 className="text-xl font-semibold">Todo CRUD Example</h3>
                <p className="text-muted-foreground">
                  A complete Todo feature demonstrating the full architecture stack from domain to
                  UI, ready to use as a reference.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="space-y-4 p-6">
                <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Layers className="h-6 w-6 text-primary" />
                </div>
                <h3 className="text-xl font-semibold">Production Deployment</h3>
                <p className="text-muted-foreground">
                  Cloudflare Workers deployment configs, CI/CD pipelines, and Turborepo for fast
                  builds out of the box.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="space-y-4 p-6">
                <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
                  <CheckCircle2 className="h-6 w-6 text-primary" />
                </div>
                <h3 className="text-xl font-semibold">Developer Experience</h3>
                <p className="text-muted-foreground">
                  Bun, TypeScript, oxlint, oxfmt, husky, lint-staged, and shared configs for a
                  smooth development workflow.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* CTA Section */}
      <div className="container mx-auto px-4 py-16">
        <Card className="max-w-3xl mx-auto">
          <CardContent className="text-center space-y-6 p-12">
            <h2 className="text-3xl font-bold">
              {isAuthenticated ? "Your Dashboard Awaits" : "Ready to Build?"}
            </h2>
            <p className="text-lg text-muted-foreground">
              {isAuthenticated
                ? "Head to the dashboard to manage your todos."
                : "Sign up and explore the Todo CRUD example to see the architecture in action."}
            </p>
            <Link to={isAuthenticated ? "/todos" : "/auth/signup"}>
              <Button size="lg" className="text-lg">
                {isAuthenticated ? "Go to Dashboard" : "Create Free Account"}{" "}
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>

      {/* Footer */}
      <footer className="container mx-auto px-4 py-8 border-t">
        <div className="text-center text-sm text-muted-foreground">
          <p>Monorepo Template - A production-ready starting point for your next project</p>
        </div>
      </footer>
    </div>
  );
}
