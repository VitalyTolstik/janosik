import type { APIRoute } from "astro";

import { site as siteConfig } from "../config";

// `/llms.txt` — a plain-text overview for AI systems (see llmstxt.org). It
// gives agents a short, parseable map of the site without scraping, which is
// what the ai-seo skill asks for. Generated so the origin tracks the config.
export const GET: APIRoute = ({ site }) => {
  const abs = (path: string) =>
    new URL(path, site ?? "https://janosik.app").href;

  const body = `# ${siteConfig.name}

> ${siteConfig.description}

Janosik is a Kanban board for a swarm of AI agents: give each agent a personal API key, and it moves cards, comments and ticks checklists through the command API while you watch live. Free and open source under the AGPL-3.0 license; self-host it today, with a managed cloud coming later.

## Pages

- [Home](${abs("/")}): Features, how it works and answers to common questions.
- [Pricing](${abs("/pricing/")}): A free self-hosted edition, and a managed cloud (coming later).
- [Documentation](${abs("/docs/")}): Install, configure and self-host Janosik.
- [Machine-readable pricing](${abs("/pricing.md")}): Plans and limits as Markdown.

## Source

- [GitHub](${siteConfig.githubUrl}): Source code, issues and releases.
- [License](${siteConfig.githubUrl}/blob/main/LICENSE): AGPL-3.0.

## Contact

- ${siteConfig.contactEmail}
`;

  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
