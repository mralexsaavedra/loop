# The LOOP server image (mralexandersaavedra/loop-server): the data service (services/loop-ingest) plus the page
# toolchain (lib/, web/, the plan generator, the syncs, scripts/refresh.mjs), so the page is built and published
# INSIDE the container (HC_BUILD=container: POST /sync and an hourly timer run scripts/refresh.mjs). No git, no
# host Node, no cron. Build from the repo root:
#   docker build -f docker/loop-server.Dockerfile --build-arg VERSION=1.0.0 -t mralexandersaavedra/loop-server:1.0.0 .
# The root .dockerignore is default-deny: only the code and the tracked seeds reach the build context, never a
# personal file (scripts/dockerignore.test.mjs). The base is pinned by digest (Dependabot proposes updates); the tag
# stays for humans.
FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402

ARG VERSION=dev
LABEL org.opencontainers.image.title="LOOP server (loop-server)" \
      org.opencontainers.image.description="LOOP data service + in-container page build" \
      org.opencontainers.image.source="https://github.com/mralexsaavedra/loop" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="$VERSION"

# HC_VERSION is what status.json reports as `commit` (scripts/refresh.mjs); the data root is the /data volume, the
# published page the /site volume, the build output a tmpfs-friendly /tmp folder. Astro's telemetry is off (it
# would write a config under the read-only home).
ENV NODE_ENV=production \
    ASTRO_TELEMETRY_DISABLED=1 \
    HC_VERSION=$VERSION \
    HC_BUILD=container \
    HC_DATA_DIR=/data \
    HC_SITE_DIR=/site \
    HC_BUILD_DIR=/tmp/loop-build/personal
WORKDIR /app

# Production dependencies only: astro and esbuild are `dependencies` of the root package.json because the page
# build is a runtime job here (eslint, typescript, subset-font stay dev-only); pg for the data service.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY services/loop-ingest/package.json services/loop-ingest/package-lock.json ./services/loop-ingest/
RUN npm --prefix services/loop-ingest ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY lib ./lib
COPY web ./web
COPY data ./data
COPY scripts ./scripts
COPY services/loop-ingest/src ./services/loop-ingest/src
COPY services/loop-ingest/sql ./services/loop-ingest/sql

# The code stays root-owned and read-only for the `node` user; it writes only the volumes and Astro's caches
# (.astro, web/.astro, web/node_modules/.astro + .vite: tmpfs under a read-only root filesystem,
# docker/docker-compose.yml).
RUN mkdir -p /data /site .astro web/.astro web/node_modules \
 && chown node:node /data /site .astro web/.astro web/node_modules

USER node
EXPOSE 8088

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:8088/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "services/loop-ingest/src/server.js"]
