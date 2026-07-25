FROM node:24-bookworm-slim AS builder

RUN corepack enable
WORKDIR /app

COPY . .
RUN pnpm install --frozen-lockfile --filter @atrib/witness-node... \
  && pnpm --recursive \
    --filter @atrib/witness-node... \
    --workspace-concurrency=1 \
    run build \
  && pnpm --filter @atrib/witness-node deploy --prod /opt/atrib-witness

FROM node:24-bookworm-slim

LABEL org.opencontainers.image.source="https://github.com/creatornader/atrib"
LABEL org.opencontainers.image.description="Independent checkpoint witness for atrib logs"
LABEL org.opencontainers.image.licenses="Apache-2.0"

ENV HOST=0.0.0.0
ENV PORT=3200
ENV ATRIB_WITNESS_STATE_DIR=/var/lib/atrib-witness

WORKDIR /app
COPY --from=builder --chown=node:node /opt/atrib-witness/ /app/
RUN mkdir -p /var/lib/atrib-witness \
  && chown node:node /var/lib/atrib-witness

USER node

EXPOSE 3200
VOLUME ["/var/lib/atrib-witness"]

HEALTHCHECK --interval=30s --timeout=10s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3200/v1/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]
