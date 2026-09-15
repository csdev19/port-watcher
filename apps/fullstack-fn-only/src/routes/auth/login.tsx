import { createFileRoute, Link, redirect } from "@tanstack/react-router";

import SignInForm from "@/components/sign-in-form";

function LoginPage() {
  return (
    <div className="mx-auto w-full mt-10 max-w-md p-6">
      <SignInForm />
      <div className="mt-4 text-center text-sm text-muted-foreground">
        Need an account?{" "}
        <Link to="/auth/signup" className="text-primary hover:underline">
          Sign Up
        </Link>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/auth/login")({
  component: LoginPage,
  beforeLoad: async (ctx) => {
    const { isAuthenticated } = ctx.context;
    if (isAuthenticated) {
      throw redirect({ to: "/todos" });
    }
  },
});
