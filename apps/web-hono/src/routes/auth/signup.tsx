import { createFileRoute, Link, redirect } from "@tanstack/react-router";

import SignUpForm from "@/components/sign-up-form";

export const Route = createFileRoute("/auth/signup")({
  component: SignUpPage,
  beforeLoad: async (ctx) => {
    const { isAuthenticated } = ctx.context;
    if (isAuthenticated) {
      throw redirect({ to: "/todos" });
    }
  },
});

function SignUpPage() {
  return (
    <div className="mx-auto w-full mt-10 max-w-md p-6">
      <SignUpForm />
      <div className="mt-4 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link to="/auth/login" className="text-primary hover:underline">
          Sign In
        </Link>
      </div>
    </div>
  );
}
