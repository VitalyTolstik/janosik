# syntax=docker/dockerfile:1

# Janosik — single-image self-host build (TASK-38b).
#
# One image serves the whole app: the API under /api/v1 and the built SPA
# (env STATIC_DIR). A self-hoster needs no separate nginx — `docker compose
# up -d` on a clean machine is the whole install.
#
# Build:  docker build -t janosik .
# Run:    see docker-compose.yml (app + postgres + redis).

# ---------------------------------------------------------------- build ----
FROM node:22-bookworm-slim AS build
WORKDIR /app

# openssl must be present when `prisma generate` runs, so the generated query
# engine targets this distro's openssl (3.0). Without it Prisma falls back to
# an openssl-1.1 target and the runtime image fails to load the engine.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

# Manifests first, so the dependency layer is cached across source edits.
COPY package.json package-lock.json ./
COPY shared/package.json shared/package.json
COPY ui/package.json ui/package.json
COPY backend/package.json backend/package.json
RUN npm ci

# Sources. Symlinks (backend/src/shared → ../../shared/src) are preserved by
# COPY and resolve inside the build context.
COPY . .

# `npm run build -w backend` runs `prisma generate` (prebuild) and compiles the
# backend + the inlined shared sources; `-w ui` builds the static frontend.
RUN npm run build -w backend && npm run build -w ui

# -------------------------------------------------------------- runtime ----
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
# Prisma needs openssl at runtime; ca-certificates for outbound TLS (SMTP,
# OAuth). ffmpeg-static ships its own binary, so no system ffmpeg is needed.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
COPY shared/package.json shared/package.json
COPY ui/package.json ui/package.json
COPY backend/package.json backend/package.json
COPY --from=build /app/node_modules ./node_modules
# Now that everything is built, drop dev-only dependencies (typescript, jest,
# the whole UI toolchain) to slim the image.
RUN npm prune --omit=dev

COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/backend/prisma ./backend/prisma
COPY --from=build /app/ui/dist ./public
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

# Serve the built UI from the API process; store blobs on a mounted volume.
ENV STATIC_DIR=/app/public
ENV UPLOAD_DIR=/data/uploads

WORKDIR /app/backend
EXPOSE 3000

# Migrations run on boot, then the API starts (see docker-entrypoint.sh).
ENTRYPOINT ["/app/docker-entrypoint.sh"]
