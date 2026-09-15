import { Link } from "@tanstack/react-router";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Button,
} from "@monorepo-template/web-ui";
import { useSignOut } from "@/hooks/use-session";
import type { AuthSession } from "@/lib/auth/types";

interface UserMenuProps {
  userName: AuthSession["user"]["name"];
  userEmail: AuthSession["user"]["email"];
  isAuthenticated: boolean;
}

export default function UserMenu({ userName, userEmail, isAuthenticated }: UserMenuProps) {
  const signOut = useSignOut();

  if (!isAuthenticated) {
    return (
      <Link to="/auth/login">
        <Button variant="outline">Sign In</Button>
      </Link>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" />}>{userName}</DropdownMenuTrigger>
      <DropdownMenuContent className="bg-card min-w-[240px]">
        <DropdownMenuGroup>
          <DropdownMenuLabel>My Account</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem>{userEmail}</DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={() => signOut.mutate()}>
            Sign Out
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
