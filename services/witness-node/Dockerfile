FROM node:24-bookworm-slim

RUN corepack enable
WORKDIR /app

COPY . .
RUN pnpm install --frozen-lockfile --filter @atrib/witness-node... \
  && pnpm --recursive \
    --filter @atrib/witness-node... \
    --workspace-concurrency=1 \
    run build

ENV HOST=0.0.0.0
ENV PORT=3200
ENV ATRIB_WITNESS_STATE_DIR=/var/lib/atrib-witness

EXPOSE 3200

CMD ["pnpm", "--filter", "@atrib/witness-node", "start"]
