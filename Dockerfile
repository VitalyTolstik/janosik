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
COPY brand/package.json brand/package.json
COPY ui/package.json ui/package.json
COPY site/package.json site/package.json
COPY backend/package.json backend/package.json
RUN npm ci

# Sources. Symlinks (backend/src/shared → ../../shared/src) are preserved by
# COPY and resolve inside the build context.
COPY . .

# The marketing site is baked with the app's sub-path (`/app/`) and a
# build-time origin for its canonical/OG tags (a self-host origin is unknown
# at build time). Override both with `--build-arg` when needed.
ARG SITE_URL=http://localhost:3000
ARG PUBLIC_APP_URL=/app/
# The commit the image was built from — stamped into the app's `version.json`
# and reported by the master panel. Pass with `--build-arg GIT_COMMIT=$(git rev-parse HEAD)`.
ARG GIT_COMMIT=
ENV SITE_URL=${SITE_URL} PUBLIC_APP_URL=${PUBLIC_APP_URL}

# `npm run build -w backend` runs `prisma generate` (prebuild) and compiles the
# backend + the inlined shared sources; `-w ui` builds the app under `/app/`;
# `-w site` builds the marketing site + docs at the root.
RUN npm run build -w backend \
  && UI_BASE=/app/ npm run build -w ui \
  && npm run build -w site

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
COPY brand/package.json brand/package.json
COPY ui/package.json ui/package.json
COPY site/package.json site/package.json
COPY backend/package.json backend/package.json
COPY --from=build /app/node_modules ./node_modules
# Now that everything is built, drop dev-only dependencies (typescript, jest,
# the whole UI toolchain) to slim the image.
RUN npm prune --omit=dev

COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/backend/prisma ./backend/prisma
# The master-account CLI (create/list/re-key an admin) — the only way to make
# a master, run in the container: `docker compose exec app node backend/scripts/admin-cli.cjs …`.
COPY --from=build /app/backend/scripts ./backend/scripts
# The app (SPA) is served under `/app/`; the marketing site + docs at `/`.
COPY --from=build /app/ui/dist ./public
COPY --from=build /app/site/dist ./site
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

# Serve the built frontends from the API process; store blobs on a volume.
ENV STATIC_DIR=/app/public
ENV SITE_DIR=/app/site
ENV UI_BASE=/app/
ENV UPLOAD_DIR=/data/uploads

# The build commit, surfaced by the observability panel (deploy.commit).
ARG GIT_COMMIT=
ENV GIT_COMMIT=${GIT_COMMIT}

# Liveness: the API readiness probe plus the site root (the baked marketing
# site), so a container that lost its static assets is reported unhealthy.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "const p=process.env.PORT||3000;Promise.all(['/api/v1/health','/'].map(u=>fetch('http://127.0.0.1:'+p+u))).then(rs=>process.exit(rs.every(r=>r.ok)?0:1)).catch(()=>process.exit(1))"

WORKDIR /app/backend
EXPOSE 3000

# Migrations run on boot, then the API starts (see docker-entrypoint.sh).
ENTRYPOINT ["/app/docker-entrypoint.sh"]
