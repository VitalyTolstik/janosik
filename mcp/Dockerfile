# syntax=docker/dockerfile:1

# Janosik MCP Streamable HTTP gateway (TASK-200.8).
#
# A separate process/container from the API: many MCP clients share one Node
# process, each session carrying its own personal API key. Build from the
# repository root because `@janosik/shared` is a workspace package:
#
#   docker build -f mcp/Dockerfile -t janosik-mcp .
#   docker run --rm -p 8080:8080 -e JANOSIK_URL=http://host.docker.internal:3000 janosik-mcp

# ---------------------------------------------------------------- build ----
FROM node:24-bookworm-slim AS build
WORKDIR /app

# Manifests first, so the dependency layer stays cached while source changes.
COPY package.json package-lock.json ./
COPY shared/package.json shared/package.json
COPY brand/package.json brand/package.json
COPY ui/package.json ui/package.json
COPY site/package.json site/package.json
COPY backend/package.json backend/package.json
COPY e2e/package.json e2e/package.json
COPY video/package.json video/package.json
COPY mcp/package.json mcp/package.json
RUN npm ci --workspace @janosik/mcp --include-workspace-root \
      --ignore-scripts --no-audit --no-fund

COPY shared ./shared
COPY mcp ./mcp
RUN npm run build -w mcp

# -------------------------------------------------------------- runtime ----
FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
# Bound V8's old space; the gateway holds many sessions in one process.
# Raise it or use several replicas for very large swarms.
ENV NODE_OPTIONS=--max-old-space-size=1024
WORKDIR /app

COPY package.json package-lock.json ./
COPY shared/package.json shared/package.json
COPY brand/package.json brand/package.json
COPY ui/package.json ui/package.json
COPY site/package.json site/package.json
COPY backend/package.json backend/package.json
COPY e2e/package.json e2e/package.json
COPY video/package.json video/package.json
COPY mcp/package.json mcp/package.json
RUN npm ci --omit=dev --workspace @janosik/mcp --include-workspace-root \
      --ignore-scripts --no-audit --no-fund \
  && npm cache clean --force

COPY --from=build /app/mcp/dist ./mcp/dist

USER node
ENV JANOSIK_MCP_HTTP_HOST=0.0.0.0
ENV JANOSIK_MCP_HTTP_PORT=8080
EXPOSE 8080

ARG APP_VERSION=dev
LABEL org.opencontainers.image.title="Janosik MCP gateway" \
      org.opencontainers.image.description="Shared MCP Streamable HTTP gateway for Janosik; one process serves many agent sessions." \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later"

# Liveness and upstream readiness are separate endpoints; the container is
# healthy only when the API it proxies to can also serve.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.JANOSIK_MCP_HTTP_PORT||8080)+'/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "/app/mcp/dist/http.js"]
