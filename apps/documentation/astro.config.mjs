// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import mermaid from "astro-mermaid";

// https://astro.build/config
export default defineConfig({
  integrations: [
    mermaid(),
    starlight({
      title: "chapay",
      lastUpdated: true,
      social: [
        { icon: "github", label: "GitHub", href: "https://github.com/csdev19/port-watcher" },
      ],
      sidebar: [
        {
          label: "Getting Started",
          items: [{ slug: "index" }],
        },
        {
          label: "Briefings",
          autogenerate: { directory: "briefings" },
        },
        {
          label: "Architecture",
          autogenerate: { directory: "architecture" },
        },
        {
          label: "Authentication",
          items: [{ slug: "authentication" }],
        },
        {
          label: "Backend",
          autogenerate: { directory: "backend" },
        },
        {
          label: "Desktop (Tauri)",
          items: [
            { slug: "desktop" },
            { slug: "desktop/tauri-vs-electron" },
            { slug: "desktop/ui-development" },
            { slug: "desktop/debugging" },
            { slug: "desktop/troubleshooting" },
          ],
        },
        {
          label: "Frontend",
          autogenerate: { directory: "frontend" },
        },
        {
          label: "Guides",
          items: [
            { slug: "application-layer" },
            { slug: "constants-pattern" },
            { slug: "domain-architecture-patterns" },
            { slug: "environment-variables" },
            { slug: "infrastructure-naming" },
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
