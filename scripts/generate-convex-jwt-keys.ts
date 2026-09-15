import { exportJWK, generateKeyPair } from "jose";

async function main() {
  const { privateKey, publicKey } = await generateKeyPair("RS256", {
    extractable: true,
  });

  const privateJwk = await exportJWK(privateKey);
  const publicJwk = await exportJWK(publicKey);

  const kid = crypto.randomUUID();

  privateJwk.kid = kid;
  privateJwk.alg = "RS256";
  privateJwk.use = "sig";

  publicJwk.kid = kid;
  publicJwk.alg = "RS256";
  publicJwk.use = "sig";

  const jwks = JSON.stringify({ keys: [publicJwk] });
  const jwksDataUri = `data:application/json,${encodeURIComponent(jwks)}`;

  console.log("=== App .env vars ===\n");
  console.log(`JWT_PRIVATE_JWK='${JSON.stringify(privateJwk)}'`);
  console.log(`JWT_KID=${kid}`);

  console.log("\n=== Convex env vars (set via: npx convex env set <KEY> <VALUE>) ===\n");
  console.log(`AUTH_ISSUER=<your BETTER_AUTH_URL value, e.g. http://localhost:3000>`);
  console.log(`JWKS_DATA_URI=${jwksDataUri}`);

  console.log("\n=== Instructions ===");
  console.log("1. Copy the app env vars into apps/fullstack-fn-and-convex/.env");
  console.log("2. Set the Convex env vars:");
  console.log("   npx convex env set AUTH_ISSUER <your BETTER_AUTH_URL>");
  console.log(`   npx convex env set JWKS_DATA_URI '${jwksDataUri}'`);
}

main().catch(console.error);
