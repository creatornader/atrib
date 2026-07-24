FROM node:24-bookworm-slim

RUN corepack enable
WORKDIR /app

COPY . .
RUN pnpm install --frozen-lockfile --filter @atrib/operating-graph... \
  && pnpm --recursive \
    --filter @atrib/operating-graph... \
    --workspace-concurrency=1 \
    run build

ENV ATRIB_OPERATING_HOST=0.0.0.0
ENV ATRIB_OPERATING_PORT=8797
ENV ATRIB_OPERATING_MIRROR=/data/records
ENV ATRIB_OPERATING_WRITES=disabled

EXPOSE 8797

CMD ["pnpm", "--filter", "@atrib/operating-graph", "start"]
