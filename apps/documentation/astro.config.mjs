// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import mermaid from "astro-mermaid";

// https://astro.build/config
export default defineConfig({
  integrations: [
    mermaid(),
    starlight({
      title: "Monorepo Template",
      lastUpdated: true,
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/withastro/starlight" }],
      sidebar: [
        {
          label: "Getting Started",
          items: [{ slug: "index" }],
        },
        {
          label: "Architecture",
          autogenerate: { directory: "architecture" },
        },
        {
          label: "Authentication",
          items: [
            { slug: "authentication" },
            { slug: "authentication/overview" },
            { slug: "authentication/implementation" },
            { slug: "authentication/quick-reference" },
          ],
        },
        {
          label: "Backend",
          autogenerate: { directory: "backend" },
        },
        {
          label: "Frontend",
          autogenerate: { directory: "frontend" },
        },
        {
          label: "Features",
          items: [
            { slug: "convex" },
            {
              label: "Convex",
              autogenerate: { directory: "features/convex" },
            },
          ],
        },
        {
          label: "Guides",
          items: [
            { slug: "application-layer" },
            { slug: "constants-pattern" },
            { slug: "domain-architecture-patterns" },
            { slug: "environment-variables" },
            { slug: "fullstack-tanstack-elysia" },
            { slug: "infrastructure-naming" },
            { slug: "mobile-app" },
            { slug: "schemas-implementation" },
            { slug: "web-ui-package" },
          ],
        },
        {
          label: "Backlog",
          autogenerate: { directory: "backlog" },
        },
        {
          label: "Changelog",
          autogenerate: { directory: "changelog" },
        },
      ],
    }),
  ],
});
