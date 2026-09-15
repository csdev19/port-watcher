import { defineCollection, z } from "astro:content";
import { docsLoader } from "@astrojs/starlight/loaders";
import { docsSchema } from "@astrojs/starlight/schema";

// Starlight only knows `title` / `description` natively; allow the extra
// frontmatter keys used by changelog entries (date, tags).
export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    schema: docsSchema({
      extend: z.object({
        date: z.union([z.string(), z.date()]).optional(),
        tags: z.array(z.string()).optional(),
      }),
    }),
  }),
};
