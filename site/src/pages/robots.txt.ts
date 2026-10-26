import type { APIRoute } from "astro";

import { withBase } from "../utils/url";

// Generated (rather than static) so the sitemap URL tracks the configured
// `site` + `base` — no hardcoded origin.
export const GET: APIRoute = ({ site }) => {
  const sitemap = new URL(withBase("/sitemap-index.xml"), site).href;
  const body = `User-agent: *\nAllow: /\n\nSitemap: ${sitemap}\n`;
  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
