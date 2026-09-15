// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    // Prevent importing server-only packages into the mobile app.
    // The mobile JS bundle can be reverse-engineered — any server code,
    // DB connection strings, or secrets bundled into it are extractable.
    // Only @monorepo-template/domain is safe (pure constants, schemas, types).
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@monorepo-template/infra-db", "@monorepo-template/infra-db/*"],
              message:
                "Do not import DB infrastructure into the mobile app. Use @monorepo-template/domain for shared types/constants.",
            },
            {
              group: ["@monorepo-template/infra-auth", "@monorepo-template/infra-auth/*"],
              message:
                "Do not import server-side auth into the mobile app. Use @monorepo-template/domain for shared types/constants.",
            },
            {
              group: ["@monorepo-template/application", "@monorepo-template/application/*"],
              message:
                "Do not import server-side use cases into the mobile app. The mobile app should call the API instead.",
            },
          ],
        },
      ],
    },
  },
]);
