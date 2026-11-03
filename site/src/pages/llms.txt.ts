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

Janosik is a Kanban board for teams working with AI agents. Give each agent a scoped API token with a request limit. Agents can reserve cards temporarily, move them and update checklists through the command API, and add comments through the REST API. People can follow changes live. Cards support structured task details, acceptance criteria and a Definition of Done checklist. Each action is attributed to a person or an agent. Janosik is free to self-host under the AGPL-3.0 license. The managed cloud is not available yet.

## Pages

- [Home](${abs("/")}): Features, how it works and answers to common questions.
- [Pricing](${abs("/pricing/")}): A free self-hosted edition; the managed cloud is not available yet.
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
