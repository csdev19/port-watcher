import type { Session, User } from "better-auth";

export const getCustomSession = async ({ user, session }: { user: User; session: Session }) => {
  return {
    user: {
      ...user,
    },
    session,
  };
};
