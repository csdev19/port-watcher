declare const process: { env: Record<string, string | undefined> };

export default {
  providers: [
    {
      type: "customJwt" as const,
      issuer: process.env.AUTH_ISSUER,
      applicationID: "convex",
      algorithm: "RS256" as const,
      jwks: process.env.JWKS_DATA_URI,
    },
  ],
};
