# The data service image, published as mralexandersaavedra/loop-ingest (.github/workflows/release.yml).
# The base is pinned by digest (Dependabot proposes updates); the tag stays for humans.
FROM node:25-alpine@sha256:bdf2cca6fe3dabd014ea60163eca3f0f7015fbd5c7ee1b0e9ccb4ced6eb02ef4

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
