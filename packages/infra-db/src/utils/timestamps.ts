import { timestamp } from "drizzle-orm/pg-core";

/**
 * Reusable timestamp fields for database tables
 *
 * Note: isActive and isInactive are NOT part of this utility.
 * They are separate status fields that should be added individually to tables as needed.
 *
 * @property createdAt - Timestamp when the record was created (required)
 * @property updatedAt - Timestamp when the record was last updated (required, auto-updated)
 * @property deletedAt - Timestamp when the record was soft deleted (nullable, NULL = not deleted)
 */
export const timestamps = {
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
  deletedAt: timestamp("deleted_at"),
};
