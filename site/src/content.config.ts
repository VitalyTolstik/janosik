import { defineCollection } from "astro:content";
import { docsLoader, i18nLoader } from "@astrojs/starlight/loaders";
import { docsSchema, i18nSchema } from "@astrojs/starlight/schema";

// Starlight's docs collection. Content lives in `src/content/docs/`; the
// English docs sit in a `docs/` sub-folder so their routes are `/docs/...`
// (see the note in `astro.config.mjs`). The optional `i18n` collection
// overrides Starlight's built-in UI strings.
export const collections = {
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
  i18n: defineCollection({ loader: i18nLoader(), schema: i18nSchema() }),
};
