FROM node:20-slim AS base
RUN corepack enable

WORKDIR /app

# Copy workspace root files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY patches/ patches/

# Copy packages the graph service depends on (mcp + verify + graph-node)
COPY packages/mcp/ packages/mcp/
COPY packages/verify/ packages/verify/
COPY services/graph-node/ services/graph-node/

RUN pnpm install --frozen-lockfile --filter @atrib/graph-node...
RUN pnpm --filter @atrib/mcp build
RUN pnpm --filter @atrib/verify build
RUN pnpm --filter @atrib/graph-node build

EXPOSE 3200

ENV PORT=3200
ENV HOST=0.0.0.0

CMD ["node", "services/graph-node/dist/main.js"]
