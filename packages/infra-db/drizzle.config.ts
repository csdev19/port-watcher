import { defineConfig } from "drizzle-kit";
import { MONOREPO_TEMPLATE_TABLE_PREFIX } from "./src/config";

export default defineConfig({
  schema: ["./src/schema", "./src/schema/enums"],
  out: "./src/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL || "",
  },
  tablesFilter: [`${MONOREPO_TEMPLATE_TABLE_PREFIX}_*`],
});
