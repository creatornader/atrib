FROM node:20-slim AS base
RUN corepack enable

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY patches/ patches/

# archive-node validates record bodies with @atrib/verify and computes hashes
# through @atrib/mcp. It is a separate body service from log-node.
COPY packages/mcp/ packages/mcp/
COPY packages/verify/ packages/verify/
COPY services/archive-node/ services/archive-node/

RUN pnpm install --frozen-lockfile --filter @atrib/archive-node...
RUN pnpm --filter @atrib/mcp build
RUN pnpm --filter @atrib/verify build
RUN pnpm --filter @atrib/archive-node build

EXPOSE 3300

ENV PORT=3300
ENV HOST=0.0.0.0

CMD ["node", "services/archive-node/dist/main.js"]
