import type { Session, User } from "better-auth";

export type AuthSession = {
  session: Session;
  user: User;
};
