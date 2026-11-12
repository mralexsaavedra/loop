# The LOOP page image (mralexandersaavedra/loop-web): nginx with the audited services/loop-web config baked in. It
# serves the page loop-server publishes into the shared site volume (mounted read-only at /usr/share/nginx/html) and
# proxies the same few routes to the data service (reached as loop-ingest:8088 on loop-net: loop-server carries that
# network alias in docker/docker-compose.yml). Build from the repo root:
#   docker build -f docker/loop-web.Dockerfile --build-arg VERSION=1.0.0 -t mralexandersaavedra/loop-web:1.0.0 .
# Single source: the template and hosts.sh are COPIED from services/loop-web unchanged (never a copy under docker/),
# so the host-mode stack and this image run the same config (scripts/loop-web-config.test.mjs pins it, and
# scripts/loop-server-compose.test.mjs pins that this file copies exactly those two). The base is the same
# digest-pinned nginx as services/loop-web/docker-compose.yml (Dependabot proposes updates); the tag stays for humans.
FROM nginx:alpine@sha256:892bb2152464f0c5d8972593a5f5afaf8054552580b699d95f8ff4af08c2d33d

ARG VERSION=dev
LABEL org.opencontainers.image.title="LOOP page (loop-web)" \
      org.opencontainers.image.description="nginx serving the LOOP page and proxying its data API routes" \
      org.opencontainers.image.source="https://github.com/mralexsaavedra/loop" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="$VERSION"

# nginx:alpine's entrypoint renders /etc/nginx/templates/*.template into /etc/nginx/conf.d/ and runs the executable
# scripts in /docker-entrypoint.d/ at every start (15-hc-hosts.sh before 20-envsubst-on-templates.sh). Both writes go
# to conf.d, a tmpfs under the compose file's read-only root filesystem.
COPY --chmod=0644 services/loop-web/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --chmod=0755 services/loop-web/hosts.sh /docker-entrypoint.d/15-hc-hosts.sh
# COPY --chmod also applies to the folder it creates: give templates/ back its search bit (the entrypoint runs with
# no DAC capability, so root cannot enter a folder without it). No default page: the site volume is the content.
# The html folder is owned by uid/gid 1000 (loop-server's `node` user, which writes the page): Docker seeds an empty
# named volume from the FIRST container that mounts it, ownership included, and `docker compose up` may create
# loop-web before loop-server starts; a root-owned seed would leave loop-server unable to publish (EACCES).
RUN chmod 0755 /etc/nginx/templates \
 && rm -f /usr/share/nginx/html/* \
 && chown 1000:1000 /usr/share/nginx/html

EXPOSE 80

# nginx answers /nginx-health itself (the template), whatever the site volume holds
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/nginx-health || exit 1
