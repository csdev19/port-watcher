// Registers use-intl's compile-time type safety: keys/namespaces come from the
// en.json shape; locales are the supported union. Imported for its side effect
// from index.ts so every consumer of @monorepo-template/i18n inherits it.
import type en from "../messages/en.json";

declare module "use-intl" {
  interface AppConfig {
    Locale: "en" | "es";
    Messages: typeof en;
  }
}
