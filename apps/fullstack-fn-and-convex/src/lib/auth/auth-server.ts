import { betterAuth } from "better-auth";
import { jwt } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { baseConfig } from "@monorepo-template/infra-auth";
import { env } from "@/env/server";

const privateJwk = JSON.parse(env.JWT_PRIVATE_JWK);

// Derive public key from private key (only kty, n, e, kid, alg, use)
const publicJwk = {
  kty: privateJwk.kty,
  n: privateJwk.n,
  e: privateJwk.e,
  kid: privateJwk.kid,
  alg: privateJwk.alg,
  use: privateJwk.use,
};

const staticJwk = {
  id: env.JWT_KID,
  publicKey: JSON.stringify(publicJwk),
  privateKey: JSON.stringify(privateJwk),
  createdAt: new Date(0),
};

export const auth = betterAuth({
  ...baseConfig,
  plugins: [
    ...(baseConfig.plugins ?? []),
    tanstackStartCookies(),
    jwt({
      jwks: {
        keyPairConfig: { alg: "RS256" },
        disablePrivateKeyEncryption: true,
      },
      jwt: {
        issuer: env.BETTER_AUTH_URL,
        audience: "convex",
        expirationTime: "1h",
        definePayload: ({ user }) => ({
          email: user.email,
          name: user.name,
        }),
      },
      adapter: {
        getJwks: async () => [staticJwk],
        createJwk: async () => staticJwk,
      },
    }),
  ],
});
