---
title: "ADR-002: One image serves the site, the docs and the app"
description: A single container image serves the marketing site at the root, the docs, and the SPA at /app/.
---

| Field | Value |
| --- | --- |
| Status | Accepted |
| Date | 2026-10-27 |
| Deciders | Janosik maintainers |

## Context

Janosik ships as a self-hostable product. The install story is
`docker compose up -d` on a clean machine, with no separate web server to
configure. The repository holds a marketing site built with Astro (with the
docs under `/docs`), a React single-page app, and the NestJS API with its SSE
stream.

The API sets a refresh cookie with `SameSite=Strict`, and the SSE stream is a
long-lived connection. Both are simplest when the site, the app and the API
share one origin. A self-hoster should not have to wire CORS, cookie domains or
proxy buffering to get a working install.

## Decision

One container image serves the whole product. The NestJS process serves the
built Astro site at `/`, the SPA at `/app/`, and the API under `/api/v1`, from
the `SITE_DIR` and `STATIC_DIR` environment variables. The `Dockerfile` builds
all three workspaces into one image, and `docker-entrypoint.sh` runs the Prisma
migrations on boot before the API starts.

`backend/src/common/serve-frontends.ts` implements the routing contract:
hashed build output is cached for a year, `index.html` and `sw.js` are
revalidated, unknown app paths fall back to the app shell, and unknown site
paths return the site's 404 page. `deploy/nginx.conf` states the same contract
for deployments that put nginx in front.

## Consequences

### Positive

- One origin means the refresh cookie and the SSE stream work without CORS or
  proxy configuration.
- The whole install is `docker compose up -d`; an upgrade is
  `docker compose pull && docker compose up -d` with migrations on boot.
- The routing contract is written once and mirrored in `serve-frontends.ts` and
  `nginx.conf`, so a proxy deployment matches the built-in one.

### Negative

- The image carries all three builds, so it is larger and any frontend rebuild
  requires a new image.
- One process serves both static files and the API, so a static-hosting problem
  can present as an API problem.
- The healthcheck probes the site root as well as the API, so a container that
  lost its static assets is reported unhealthy even if the API answers.

### Neutral

- nginx is optional; `deploy/nginx.conf` is for deployments that add a proxy.
- A self-hoster who wants external hosting for the site can set `SITE_URL` and
  `SITE_BASE`, and the app stays on the image.
- The docs live under `/docs` because Starlight owns that subtree while the
  marketing pages own the root.

## Alternatives considered

- **GitHub Pages for the site.** Strongest argument for: free static hosting and
  a custom domain with no image weight. Rejected because it splits the origin
  from the app, which breaks the cookie and SSE assumptions and the single
  install story.
- **A separate nginx container.** Strongest argument for: a battle-tested static
  server that scales independently from the API. Rejected for the default
  because it adds a moving part the self-hoster must configure;
  `deploy/nginx.conf` stays available for those who want it.
- **A CDN for static assets.** Strongest argument for: lower global latency and
  less load on the API process. Rejected for the default because it adds an
  external dependency and cache-invalidation work to a single-instance product.

## References

- `Dockerfile`
- `docker-compose.yml`
- `backend/src/common/serve-frontends.ts`
- `deploy/nginx.conf`
- `docs/SELF-HOSTING.md`
