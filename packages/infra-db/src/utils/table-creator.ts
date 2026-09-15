import { MONOREPO_TEMPLATE_TABLE_PREFIX } from "../config";
import { pgTableCreator } from "drizzle-orm/pg-core";

export const createTable = pgTableCreator((name) => `${MONOREPO_TEMPLATE_TABLE_PREFIX}_${name}`);
