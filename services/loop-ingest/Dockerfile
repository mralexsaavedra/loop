# The data service image, published as mralexandersaavedra/loop-ingest (.github/workflows/release.yml).
# The base is pinned by digest (Dependabot proposes updates); the tag stays for humans.
FROM node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914

ARG VERSION=dev
LABEL org.opencontainers.image.title="LOOP data service (loop-ingest)" \
      org.opencontainers.image.source="https://github.com/mralexsaavedra/loop" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="$VERSION"

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY sql ./sql

USER node
EXPOSE 8088

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://localhost:8088/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
