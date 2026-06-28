FROM node:22-slim

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY patches/ patches/
COPY packages/ packages/

RUN pnpm install --frozen-lockfile --filter @atrib/integration... --ignore-scripts
RUN pnpm rebuild esbuild
RUN pnpm --filter @atrib/mcp build
RUN pnpm --filter @atrib/mcp-wrap build

EXPOSE 8080

ENV PORT=8080
ENV HOST=0.0.0.0

CMD ["node", "--import", "tsx", "packages/integration/examples/firecrawl-web-ingestion/live-demo/server.ts"]
