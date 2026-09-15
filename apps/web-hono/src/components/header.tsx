import { Link } from "@tanstack/react-router";

import UserMenu from "./user-menu";
import type { AuthSession } from "@/lib/auth/types";

interface HeaderProps {
  isAuthenticated: boolean;
  userName: AuthSession["user"]["name"];
  userEmail: AuthSession["user"]["email"];
}

export default function Header({ isAuthenticated, userName, userEmail }: HeaderProps) {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-background border-b">
      <div className="flex flex-row items-center justify-between px-4 py-2">
        <nav className="flex items-center gap-4 text-lg">
          <Link to="/" className="font-semibold">
            Monorepo Template
          </Link>
          {isAuthenticated && (
            <Link
              to="/todos"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Dashboard
            </Link>
          )}
        </nav>
        <div className="flex items-center gap-2">
          <UserMenu userName={userName} userEmail={userEmail} isAuthenticated={isAuthenticated} />
        </div>
      </div>
    </header>
  );
}
